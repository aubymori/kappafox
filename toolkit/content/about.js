/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// We need to wait for Fluent to fill the elements first
async function waitForElement(sel) {
  while (document.querySelector(sel) == null) {
    await new Promise(r => requestAnimationFrame(r));
  }
  return document.querySelector(sel);
}

// insert the version of the XUL application (!= XULRunner platform version)
waitForElement("#version:not(:empty)").then(version => {
  version.textContent += " " + Services.appinfo.version;
});

// append user agent
waitForElement("#buildID:not(:empty)").then(buildID => {
  buildID.textContent += " " + navigator.userAgent;
});