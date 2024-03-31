/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { PrivateBrowsingUtils } = ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
const { SessionStore } = ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs");

/* import-globals-from ../contentSearchUI.js */

const SNIPPETS_UPDATE_INTERVAL_MS = 14400000; // 4 hours.

// IndexedDB storage constants.
const DATABASE_NAME = "abouthome";
const DATABASE_VERSION = 1;
const DATABASE_STORAGE = "persistent";
const SNIPPETS_OBJECTSTORE_NAME = "snippets";
var searchText;

// This global tracks if the page has been set up before, to prevent double inits
var gInitialized = false;
var gObserver = new MutationObserver(function(mutations) {
  for (let mutation of mutations) {
    // The addition of the restore session button changes our width:
    if (mutation.attributeName == "session") {
      fitToWidth();
    }
  }
});

window.addEventListener("pageshow", function() {
  // Delay search engine setup, cause browser.js::BrowserOnAboutPageLoad runs
  // later and may use asynchronous getters.
  window.gObserver.observe(document.documentElement, { attributes: true });
  window.gObserver.observe(document.getElementById("launcher"), { attributes: true });
  fitToWidth();
  setupSearch();
  window.addEventListener("resize", fitToWidth);

  // Ask chrome to update snippets.
  var event = new CustomEvent("AboutHomeLoad", {bubbles: true});
  document.dispatchEvent(event);
});

window.addEventListener("pagehide", function() {
  window.gObserver.disconnect();
  window.removeEventListener("resize", fitToWidth);
});

window.addEventListener("keypress", ev => {
  if (ev.defaultPrevented) {
    return;
  }

  // don't focus the search-box on keypress if something other than the
  // body or document element has focus - don't want to steal input from other elements
  // Make an exception for <a> and <button> elements (and input[type=button|submit])
  // which don't usefully take keypresses anyway.
  // (except space, which is handled below)
  if (document.activeElement && document.activeElement != document.body &&
      document.activeElement != document.documentElement &&
      !["a", "button"].includes(document.activeElement.localName) &&
      !document.activeElement.matches("input:-moz-any([type=button],[type=submit])")) {
    return;
  }

  let modifiers = ev.ctrlKey + ev.altKey + ev.metaKey;
  // ignore Ctrl/Cmd/Alt, but not Shift
  // also ignore Tab, Insert, PageUp, etc., and Space
  if (modifiers != 0 || ev.charCode == 0 || ev.charCode == 32)
    return;

  searchText.focus();
  // need to send the first keypress outside the search-box manually to it
  searchText.value += ev.key;
});

// This object has the same interface as Map and is used to store and retrieve
// the snippets data.  It is lazily initialized by ensureSnippetsMapThen(), so
// be sure its callback returned before trying to use it.
var gSnippetsMap;
var gSnippetsMapCallbacks = [];

function onSearchSubmit(aEvent) {
  gContentSearchController.search(aEvent);
}


var gContentSearchController;

function setupSearch() {
  // Set submit button label for when CSS background are disabled (e.g.
  // high contrast mode).
  document.getElementById("searchSubmit").value =
    document.body.getAttribute("dir") == "ltr" ? "\u25B6" : "\u25C0";

  // The "autofocus" attribute doesn't focus the form element
  // immediately when the element is first drawn, so the
  // attribute is also used for styling when the page first loads.
  searchText = document.getElementById("searchText");
  searchText.addEventListener("blur", function() {
    searchText.removeAttribute("autofocus");
  }, {once: true});

  if (!gContentSearchController) {
    gContentSearchController =
      new ContentSearchUIController(searchText, searchText.parentNode,
                                    "abouthome", "homepage");
  }
}

/**
 * Clear snippets element contents and show default snippets.
 */
function showDefaultSnippets() {
  // Clear eventual contents...
  let snippetsElt = document.getElementById("snippets");
  snippetsElt.innerHTML = "";

  // ...then show default snippets.
  let defaultSnippetsElt = document.getElementById("defaultSnippets");
  let entries = defaultSnippetsElt.querySelectorAll("span");
  // Choose a random snippet.  Assume there is always at least one.
  let randIndex = Math.floor(Math.random() * entries.length);
  let entry = entries[randIndex];
  // Move the default snippet to the snippets element.
  snippetsElt.appendChild(entry);
}

function fitToWidth() {
  if (document.documentElement.scrollWidth > window.innerWidth) {
    document.body.setAttribute("narrow", "true");
  } else if (document.body.hasAttribute("narrow")) {
    document.body.removeAttribute("narrow");
    fitToWidth();
  }
}

function updateSessionRestoreState() {
  if (SessionStore.canRestoreLastSession && !PrivateBrowsingUtils.isContentWindowPrivate(window)) {
    document.getElementById("launcher").setAttribute("session", "true");
  }
}

document.addEventListener("DOMContentLoaded", showDefaultSnippets);
document.addEventListener("DOMContentLoaded", updateSessionRestoreState);

function onLaunchButtonClick(event) {
  let browser = windowRoot.ownerGlobal;
  switch (event.target.id) {
    case "downloads":
      browser.BrowserDownloadsUI();
      break;
    case "bookmarks":
        browser.PlacesCommandHook.showPlacesOrganizer("UnfiledBookmarks");
        break;
    case "history":
      browser.PlacesCommandHook.showPlacesOrganizer("History");
      break;
    case "addons":
      browser.BrowserOpenAddonsMgr();
      break;
    case "sync":
      browser.openPreferences("sync");
      break;
    case "settings":
      browser.openPreferences();
      break;
    case "restorePreviousSession":
      if (SessionStore.canRestoreLastSession) {
        SessionStore.restoreLastSession();
        document.getElementById("launcher").removeAttribute("session");
      }
      break;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("launcher").addEventListener("click", onLaunchButtonClick);
  document.getElementById("searchSubmit").addEventListener("click", onSearchSubmit);
});