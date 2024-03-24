/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "IDTracker.h"

#include "mozilla/Encoding.h"
#include "mozilla/dom/Document.h"
#include "mozilla/dom/DocumentOrShadowRoot.h"
#include "mozilla/dom/ShadowRoot.h"
#include "nsAtom.h"
#include "nsContentUtils.h"
#include "nsIURI.h"
#include "nsIReferrerInfo.h"
#include "nsBindingManager.h"
#include "nsXBLPrototypeBinding.h"
#include "nsEscape.h"
#include "nsCycleCollectionParticipant.h"
#include "nsStringFwd.h"

namespace mozilla::dom {

static Element* LookupElement(DocumentOrShadowRoot& aDocOrShadow,
                              const nsAString& aRef, bool aReferenceImage) {
  if (aReferenceImage) {
    return aDocOrShadow.LookupImageElement(aRef);
  }
  return aDocOrShadow.GetElementById(aRef);
}

static DocumentOrShadowRoot* FindTreeToWatch(nsIContent& aContent,
                                             const nsAString& aID,
                                             bool aReferenceImage) {
  ShadowRoot* shadow = aContent.GetContainingShadow();

  // We allow looking outside an <svg:use> shadow tree for backwards compat.
  while (shadow && shadow->Host()->IsSVGElement(nsGkAtoms::use)) {
    // <svg:use> shadow trees are immutable, so we can just early-out if we find
    // our relevant element instead of having to support watching multiple
    // trees.
    if (LookupElement(*shadow, aID, aReferenceImage)) {
      return shadow;
    }
    shadow = shadow->Host()->GetContainingShadow();
  }

  if (shadow) {
    return shadow;
  }

  return aContent.OwnerDoc();
}

IDTracker::IDTracker() = default;

IDTracker::~IDTracker() { Unlink(); }

void IDTracker::ResetToURIFragmentID(nsIContent* aFromContent, nsIURI* aURI,
                                     nsIReferrerInfo* aReferrerInfo,
                                     bool aWatch, bool aReferenceImage) {
  MOZ_ASSERT(aFromContent,
             "ResetToURIFragmentID() expects non-null content pointer");

  Unlink();

  if (!aURI) return;

  nsAutoCString refPart;
  aURI->GetRef(refPart);
  // Unescape %-escapes in the reference. The result will be in the
  // document charset, hopefully...
  NS_UnescapeURL(refPart);

  // Get the thing to observe changes to.
  Document* doc = aFromContent->OwnerDoc();
  auto encoding = doc->GetDocumentCharacterSet();

  nsAutoString ref;
  nsresult rv = encoding->DecodeWithoutBOMHandling(refPart, ref);
  if (NS_FAILED(rv) || ref.IsEmpty()) {
    return;
  }

  nsIContent* bindingParent = aFromContent->GetBindingParent();
  if (bindingParent && !aFromContent->IsInShadowTree()) {
    nsXBLBinding* binding = bindingParent->GetXBLBinding();
    if (!binding) {
      // This happens, for example, if aFromContent is part of the content
      // inserted by a call to Document::InsertAnonymousContent, which we
      // also want to handle.  (It also happens for <use>'s anonymous
      // content etc.)
      Element* anonRoot =
          doc->GetAnonRootIfInAnonymousContentContainer(aFromContent);
      if (anonRoot) {
        mElement = nsContentUtils::MatchElementId(anonRoot, ref);
        // We don't have watching working yet for anonymous content, so bail out
        // here.
        return;
      }
    } else {
      bool isEqualExceptRef;
      rv = aURI->EqualsExceptRef(binding->PrototypeBinding()->DocURI(),
                                 &isEqualExceptRef);
      if (NS_SUCCEEDED(rv) && isEqualExceptRef) {
        // XXX sXBL/XBL2 issue
        // Our content is an anonymous XBL element from a binding inside the
        // same document that the referenced URI points to. In order to avoid
        // the risk of ID collisions we restrict ourselves to anonymous
        // elements from this binding; specifically, URIs that are relative to
        // the binding document should resolve to the copy of the target
        // element that has been inserted into the bound document.
        // If the URI points to a different document we don't need this
        // restriction.
        nsINodeList* anonymousChildren =
            doc->BindingManager()->GetAnonymousNodesFor(bindingParent);

        if (anonymousChildren) {
          uint32_t length = anonymousChildren->Length();
          for (uint32_t i = 0; i < length && !mElement; ++i) {
            mElement =
                nsContentUtils::MatchElementId(anonymousChildren->Item(i), ref);
          }
        }

        // We don't have watching working yet for XBL, so bail out here.
        return;
      }
    }
}

void IDTracker::ResetWithLocalRef(Element& aFrom, const nsAString& aLocalRef,
                                  bool aWatch) {
  MOZ_ASSERT(nsContentUtils::IsLocalRefURL(aLocalRef));

  nsAutoCString ref;
  if (!AppendUTF16toUTF8(Substring(aLocalRef, 1), ref, mozilla::fallible)) {
    Unlink();
    return;
  }
  NS_UnescapeURL(ref);
  RefPtr<nsAtom> idAtom = NS_Atomize(ref);
  ResetWithID(aFrom, idAtom, aWatch);
}

void IDTracker::ResetWithID(Element& aFrom, nsAtom* aID, bool aWatch) {
  MOZ_ASSERT(aID);

  Unlink();

  if (aID->IsEmpty()) {
    return;
  }

  if (aWatch) {
    mWatchID = aID;
  }

  mReferencingImage = false;

  nsDependentAtomString str(aID);
  DocumentOrShadowRoot* docOrShadow =
      FindTreeToWatch(aFrom, str, /* aReferenceImage = */ false);
  HaveNewDocumentOrShadowRoot(docOrShadow, aWatch, str);
}

void IDTracker::HaveNewDocumentOrShadowRoot(DocumentOrShadowRoot* aDocOrShadow,
                                            bool aWatch, const nsString& aRef) {
  if (aWatch) {
    mWatchDocumentOrShadowRoot = nullptr;
    if (aDocOrShadow) {
      mWatchDocumentOrShadowRoot = &aDocOrShadow->AsNode();
      mElement = aDocOrShadow->AddIDTargetObserver(mWatchID, Observe, this,
                                                   mReferencingImage);
    }
    return;
  }

  if (!aDocOrShadow) {
    return;
  }

  if (Element* e = LookupElement(*aDocOrShadow, aRef, mReferencingImage)) {
    mElement = e;
  }
}

void IDTracker::Traverse(nsCycleCollectionTraversalCallback* aCB) {
  NS_CYCLE_COLLECTION_NOTE_EDGE_NAME(*aCB, "mWatchDocumentOrShadowRoot");
  aCB->NoteXPCOMChild(mWatchDocumentOrShadowRoot);
  NS_CYCLE_COLLECTION_NOTE_EDGE_NAME(*aCB, "mElement");
  aCB->NoteXPCOMChild(mElement);
}

void IDTracker::Unlink() {
  if (mWatchID) {
    if (DocumentOrShadowRoot* docOrShadow = GetWatchDocOrShadowRoot()) {
      docOrShadow->RemoveIDTargetObserver(mWatchID, Observe, this,
                                          mReferencingImage);
    }
  }
  if (mPendingNotification) {
    mPendingNotification->Clear();
    mPendingNotification = nullptr;
  }
  mWatchDocumentOrShadowRoot = nullptr;
  mWatchID = nullptr;
  mElement = nullptr;
  mReferencingImage = false;
}

void IDTracker::ElementChanged(Element* aFrom, Element* aTo) { mElement = aTo; }

bool IDTracker::Observe(Element* aOldElement, Element* aNewElement,
                        void* aData) {
  IDTracker* p = static_cast<IDTracker*>(aData);
  if (p->mPendingNotification) {
    p->mPendingNotification->SetTo(aNewElement);
  } else {
    NS_ASSERTION(aOldElement == p->mElement, "Failed to track content!");
    ChangeNotification* watcher =
        new ChangeNotification(p, aOldElement, aNewElement);
    p->mPendingNotification = watcher;
    nsContentUtils::AddScriptRunner(watcher);
  }
  bool keepTracking = p->IsPersistent();
  if (!keepTracking) {
    p->mWatchDocumentOrShadowRoot = nullptr;
    p->mWatchID = nullptr;
  }
  return keepTracking;
}

IDTracker::ChangeNotification::ChangeNotification(IDTracker* aTarget,
                                                  Element* aFrom, Element* aTo)
    : mozilla::Runnable("IDTracker::ChangeNotification"),
      Notification(aTarget),
      mFrom(aFrom),
      mTo(aTo) {}

IDTracker::ChangeNotification::~ChangeNotification() = default;

void IDTracker::ChangeNotification::SetTo(Element* aTo) { mTo = aTo; }

void IDTracker::ChangeNotification::Clear() {
  Notification::Clear();
  mFrom = nullptr;
  mTo = nullptr;
}

NS_IMPL_ISUPPORTS_INHERITED0(IDTracker::ChangeNotification, mozilla::Runnable)
NS_IMPL_ISUPPORTS(IDTracker::DocumentLoadNotification, nsIObserver)

NS_IMETHODIMP
IDTracker::DocumentLoadNotification::Observe(nsISupports* aSubject,
                                             const char* aTopic,
                                             const char16_t* aData) {
  NS_ASSERTION(!strcmp(aTopic, "external-resource-document-created"),
               "Unexpected topic");
  if (mTarget) {
    nsCOMPtr<Document> doc = do_QueryInterface(aSubject);
    mTarget->mPendingNotification = nullptr;
    NS_ASSERTION(!mTarget->mElement, "Why do we have content here?");
    // If we got here, that means we had Reset*() called with
    // aWatch == true.  So keep watching if IsPersistent().
    mTarget->HaveNewDocumentOrShadowRoot(doc, mTarget->IsPersistent(), mRef);
    mTarget->ElementChanged(nullptr, mTarget->mElement);
  }
  return NS_OK;
}

DocumentOrShadowRoot* IDTracker::GetWatchDocOrShadowRoot() const {
  if (!mWatchDocumentOrShadowRoot) {
    return nullptr;
  }
  MOZ_ASSERT(mWatchDocumentOrShadowRoot->IsDocument() ||
             mWatchDocumentOrShadowRoot->IsShadowRoot());
  if (ShadowRoot* shadow = ShadowRoot::FromNode(*mWatchDocumentOrShadowRoot)) {
    return shadow;
  }
  return mWatchDocumentOrShadowRoot->AsDocument();
}

}  // namespace mozilla::dom
