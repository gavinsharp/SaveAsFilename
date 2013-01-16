/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let Cu = Components.utils;
let Ci = Components.interfaces;

Cu.import("resource://gre/modules/Services.jsm");

function startup(aData, aReason) {
  // Monkeypatch all browser windows, current and future
  watchWindows(function (window) {
    // Stash the default version of the function
    window._saveAsFilename_getDefaultFileName = window.getDefaultFileName;
    window.getDefaultFileName = function (aDefaultFileName, aURI, aDocument, aContentDisposition) {
      // Copy the bits from getDefaultFileName that attempt to retrieve the
      // filename (either from the content disposition header, or from the URL
      // itself). This essentially undoes the fix for bug 254139.
      if (aContentDisposition) {
        const mhpContractID = "@mozilla.org/network/mime-hdrparam;1";
        const mhpIID = Components.interfaces.nsIMIMEHeaderParam;
        const mhp = Components.classes[mhpContractID].getService(mhpIID);
        var dummy = { value: null };  // Need an out param...
        var charset = window.getCharsetforSave(aDocument);
        var fileName = null;
        try {
          fileName = mhp.getParameter(aContentDisposition, "filename", charset,
                                      true, dummy);
        }
        catch (e) {
          try {
            fileName = mhp.getParameter(aContentDisposition, "name", charset, true,
                                        dummy);
          }
          catch (e) {
          }
        }
        if (fileName)
          return fileName;
      }

      try {
        let url = aURI.QueryInterface(Ci.nsIURL);
        if (url.fileName != "") {
          var textToSubURI = Components.classes["@mozilla.org/intl/texttosuburi;1"]
                                       .getService(Components.interfaces.nsITextToSubURI);
          return window.validateFileName(textToSubURI.unEscapeURIForUI(url.originCharset || "UTF-8", url.fileName));
        }
      } catch (e) {
        // This is something like a data: and so forth URI... no filename here.
      }

      // Delegate to the default version
      return window._saveAsFilename_getDefaultFileName.apply(window, arguments);
    }.bind(window);
  });
}

function shutdown(aData, aReason) {
  if (aReason != APP_SHUTDOWN) {
    let enumerator = Services.wm.getEnumerator("navigator:browser");
    while (enumerator.hasMoreElements()) {
      let win = XPCNativeWrapper.unwrap(enumerator.getNext());
      if (win._saveAsFilename_getDefaultFileName) {
        win.getDefaultFileName = win._saveAsFilename_getDefaultFileName;
        delete win._saveAsFilename_getDefaultFileName;
      }
    }

    unloaders.forEach(function (f) {
      try {
        f();
      } catch (ex) {}
    });
  }
}

function install(aData, aReason) { }

function uninstall(aData, aReason) { }

/* Code from: https://github.com/Mardak/restartless/blob/watchWindows/bootstrap.js */
let unloaders = [];

function watchWindows(callback) {
  // Wrap the callback in a function that ignores failures
  function watcher(window) {
    try {
      // Now that the window has loaded, only handle browser windows
      let documentElement = window.document.documentElement;
      if (documentElement.getAttribute("windowtype") == "navigator:browser")
        callback(window);
    }
    catch(ex) {}
  }

  // Wait for the window to finish loading before running the callback
  function runOnLoad(window) {
    // Listen for one load event before checking the window type
    window.addEventListener("load", function runOnce() {
      window.removeEventListener("load", runOnce, false);
      watcher(window);
    }, false);
  }

  // Add functionality to existing windows
  let windows = Services.wm.getEnumerator(null);
  while (windows.hasMoreElements()) {
    // Only run the watcher immediately if the window is completely loaded
    let window = windows.getNext();
    if (window.document.readyState == "complete")
      watcher(window);
    // Wait for the window to load before continuing
    else
      runOnLoad(window);
  }

  // Watch for new browser windows opening then wait for it to load
  function windowWatcher(subject, topic) {
    if (topic == "domwindowopened")
      runOnLoad(subject);
  }
  Services.ww.registerNotification(windowWatcher);
  unloaders.push(function() Services.ww.unregisterNotification(windowWatcher));
}
