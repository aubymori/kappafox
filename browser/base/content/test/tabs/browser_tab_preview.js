/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

async function openPreview(tab) {
  const previewShown = BrowserTestUtils.waitForEvent(
    document.getElementById("tabbrowser-tab-preview"),
    "previewshown",
    false,
    e => {
      return e.detail.tab === tab;
    }
  );
  EventUtils.synthesizeMouseAtCenter(tab, { type: "mouseover" });
  return previewShown;
}

async function closePreviews() {
  const tabs = document.getElementById("tabbrowser-tabs");
  const previewHidden = BrowserTestUtils.waitForEvent(
    document.getElementById("tabbrowser-tab-preview"),
    "previewhidden"
  );
  EventUtils.synthesizeMouse(tabs, 0, tabs.outerHeight + 1, {
    type: "mouseout",
  });
  return previewHidden;
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [
      ["browser.tabs.cardPreview.enabled", true],
      ["browser.tabs.cardPreview.showThumbnails", false],
      ["ui.tooltip.delay_ms", 0],
    ],
  });
});

/**
 * Verify the following:
 *
 * 1. Tab preview card appears when the mouse hovers over a tab
 * 2. Tab preview card shows the correct preview for the tab being hovered
 * 3. Tab preview card is dismissed when the mouse leaves the tab bar
 */
add_task(async function hoverTests() {
  const tabUrl1 =
    "data:text/html,<html><head><title>First New Tab</title></head><body>Hello</body></html>";
  const tab1 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl1);
  const tabUrl2 =
    "data:text/html,<html><head><title>Second New Tab</title></head><body>Hello</body></html>";
  const tab2 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl2);
  const previewContainer = document.getElementById("tabbrowser-tab-preview");

  await openPreview(tab1);
  Assert.ok(
    ["open", "showing"].includes(previewContainer.panel.state),
    "tab1 preview shown"
  );
  Assert.equal(
    previewContainer.renderRoot.querySelector(".tab-preview-title").innerText,
    "First New Tab",
    "Preview of tab1 shows correct title"
  );

  await openPreview(tab2);
  Assert.ok(
    ["open", "showing"].includes(previewContainer.panel.state),
    "tab2 preview shown"
  );
  Assert.equal(
    previewContainer.renderRoot.querySelector(".tab-preview-title").innerText,
    "Second New Tab",
    "Preview of tab2 shows correct title"
  );

  await closePreviews();
  Assert.ok(
    ["closed", "hiding"].includes(previewContainer.panel.state),
    "preview container is now hidden"
  );

  BrowserTestUtils.removeTab(tab1);
  BrowserTestUtils.removeTab(tab2);

  // Move the mouse outside of the tab strip.
  EventUtils.synthesizeMouseAtCenter(document.documentElement, {
    type: "mouseover",
  });
});

/**
 * Verify that non-selected tabs display a thumbnail in their preview
 * when browser.tabs.cardPreview.showThumbnails is set to true,
 * while the currently selected tab never displays a thumbnail in its preview.
 */
add_task(async function thumbnailTests() {
  await SpecialPowers.pushPrefEnv({
    set: [["browser.tabs.cardPreview.showThumbnails", true]],
  });
  const tabUrl1 = "about:blank";
  const tab1 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl1);
  const tabUrl2 = "about:blank";
  const tab2 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl2);
  const previewContainer = document.getElementById("tabbrowser-tab-preview");

  const thumbnailUpdated = BrowserTestUtils.waitForEvent(
    previewContainer,
    "previewThumbnailUpdated"
  );
  await openPreview(tab1);
  await thumbnailUpdated;
  Assert.ok(
    previewContainer.renderRoot.querySelectorAll("img,canvas").length,
    "Tab1 preview contains thumbnail"
  );

  await openPreview(tab2);
  Assert.equal(
    previewContainer.renderRoot.querySelectorAll("img,canvas").length,
    0,
    "Tab2 (selected) does not contain thumbnail"
  );

  const previewHidden = BrowserTestUtils.waitForEvent(
    document.getElementById("tabbrowser-tab-preview"),
    "previewhidden"
  );

  BrowserTestUtils.removeTab(tab1);
  BrowserTestUtils.removeTab(tab2);
  await SpecialPowers.popPrefEnv();

  // Removing the tab should close the preview.
  await previewHidden;

  // Move the mouse outside of the tab strip.
  EventUtils.synthesizeMouseAtCenter(document.documentElement, {
    type: "mouseover",
  });
});

/**
 * Wheel events at the document-level of the window should hide the preview.
 */
add_task(async function wheelTests() {
  const tabUrl1 = "about:blank";
  const tab1 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl1);
  const tabUrl2 = "about:blank";
  const tab2 = await BrowserTestUtils.openNewForegroundTab(gBrowser, tabUrl2);

  await openPreview(tab1);

  const tabs = document.getElementById("tabbrowser-tabs");
  const previewHidden = BrowserTestUtils.waitForEvent(
    document.getElementById("tabbrowser-tab-preview"),
    "previewhidden"
  );

  // Copied from apz_test_native_event_utils.js
  let message = 0;
  switch (AppConstants.platform) {
    case "win":
      message = 0x020a;
      break;
    case "linux":
      message = 4;
      break;
    case "macosx":
      message = 1;
      break;
  }

  let rect = tabs.getBoundingClientRect();
  let screenRect = window.windowUtils.toScreenRect(
    rect.x,
    rect.y,
    rect.width,
    rect.height
  );
  window.windowUtils.sendNativeMouseScrollEvent(
    screenRect.left,
    screenRect.bottom,
    message,
    0,
    3,
    0,
    0,
    Ci.nsIDOMWindowUtils.MOUSESCROLL_SCROLL_LINES,
    tabs,
    null
  );

  await previewHidden;

  BrowserTestUtils.removeTab(tab1);
  BrowserTestUtils.removeTab(tab2);
  await SpecialPowers.popPrefEnv();

  // Move the mouse outside of the tab strip.
  EventUtils.synthesizeMouseAtCenter(document.documentElement, {
    type: "mouseover",
  });
});
