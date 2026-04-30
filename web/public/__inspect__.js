(function() {
  'use strict';

  window.__foxInspectMode = false;
  window.__foxSessionId = null;
  window.__foxSessionTitle = null;
  window.__foxInspectEnabled = true;
  window.__foxSentPending = false;
  window.__foxPopupOpen = false;
  window.__foxHighlightedEl = null;

  var overlayStyle = document.createElement('style');
  overlayStyle.textContent = [
    '#__fox-overlay{position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:system-ui,sans-serif;font-size:13px;pointer-events:none}',
    '#__fox-widget{background:#1e1e1e;color:#e0e0e0;padding:8px 12px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.4);display:flex;align-items:center;gap:10px;pointer-events:auto}',
    '#__fox-widget .__fox-label{font-size:12px;font-weight:500;color:#888}',
    '#__fox-toggle{background:#3b82f6;color:#fff;border:none;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit}',
    '#__fox-toggle:hover{background:#2563eb}',
    '#__fox-toggle.__fox-active{background:#ef4444}',
    '#__fox-toggle.__fox-active:hover{background:#dc2626}',
    '.__fox-highlight{outline:2px solid #3b82f6!important;outline-offset:1px!important}',
    '#__fox-popup{position:fixed;background:#1e1e1e;color:#e0e0e0;padding:12px;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,.5);z-index:2147483647;min-width:300px;max-width:400px;pointer-events:auto;font-family:system-ui,sans-serif}',
    '#__fox-popup .__fox-selector{font-family:monospace;font-size:11px;color:#888;background:#2a2a2a;padding:4px 8px;border-radius:4px;word-break:break-all;margin-bottom:8px;max-height:80px;overflow:auto}',
    '#__fox-popup .__fox-tag{font-size:12px;color:#aaa;margin-bottom:8px}',
    '#__fox-popup .__fox-tag span{color:#3b82f6}',
    '#__fox-popup textarea{width:100%;background:#2a2a2a;color:#e0e0e0;border:1px solid #444;border-radius:4px;padding:6px 8px;font-size:12px;resize:vertical;min-height:60px;box-sizing:border-box;font-family:inherit}',
    '#__fox-popup textarea:focus{border-color:#3b82f6;outline:none}',
    '#__fox-popup .__fox-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}',
    '#__fox-popup button.__fox-send{background:#3b82f6;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit}',
    '#__fox-popup button.__fox-send:hover{background:#2563eb}',
    '#__fox-popup button.__fox-cancel{background:transparent;color:#888;border:1px solid #444;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-family:inherit}',
    '#__fox-popup button.__fox-cancel:hover{color:#aaa;border-color:#666}',
    '#__fox-popup .__fox-hint{font-size:11px;color:#666;margin-top:6px;line-height:1.4}'
  ].join('\n');

  var overlay = document.createElement('div');
  overlay.id = '__fox-overlay';
  overlay.innerHTML = '<div id="__fox-widget">' +
    '<span class="__fox-label">OpenFox</span>' +
    '<button id="__fox-toggle">Send feedback</button>' +
    '</div>';

  var toggleBtn;

  function setInspectMode(enabled) {
    window.__foxInspectMode = enabled;
    if (toggleBtn) {
      toggleBtn.textContent = enabled ? 'Exit inspect' : 'Send feedback';
      toggleBtn.classList.toggle('__fox-active', enabled);
    }
  }

  function clearHighlights() {
    if (window.__foxHighlightedEl) {
      window.__foxHighlightedEl.classList.remove('__fox-highlight');
      window.__foxHighlightedEl = null;
    }
  }

  function generateXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    var parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
      var index = 1;
      var sibling = el.previousSibling;
      while (sibling) {
        if (sibling.nodeType === Node.ELEMENT_NODE && sibling.nodeName === el.nodeName) index++;
        sibling = sibling.previousSibling;
      }
      parts.unshift(el.nodeName.toLowerCase() + '[' + index + ']');
      el = el.parentNode;
    }
    return '/' + parts.join('/');
  }

  function stripSvgAndGetText(el) {
    try {
      var clone = el.cloneNode(true);
      var svgs = clone.querySelectorAll('svg');
      for (var i = 0; i < svgs.length; i++) {
        svgs[i].remove();
      }
      var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      return text.slice(0, 500) || null;
    } catch (e) {
      return null;
    }
  }

  function buildElementData(el) {
    var attrs = {};
    if (el.attributes) {
      for (var i = 0; i < el.attributes.length; i++) {
        var attr = el.attributes[i];
        if (attr.name !== 'class' && attr.name !== 'id') {
          attrs[attr.name] = attr.value;
        }
      }
    }
    var rect = el.getBoundingClientRect();
    var tagName = el.tagName ? el.tagName.toLowerCase() : '';
    return {
      tag: tagName,
      id: el.id || null,
      className: (typeof el.className === 'string' ? el.className : '') || null,
      xpath: generateXPath(el),
      text: (el.innerText || '').slice(0, 500) || null,
      textContent: stripSvgAndGetText(el),
      outerHTML: (el.outerHTML || '').slice(0, 1000) || '',
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      attributes: attrs
    };
  }

  function showPopup(el, x, y) {
    var existing = document.getElementById('__fox-popup');
    if (existing) existing.remove();

    window.__foxPopupOpen = true;
    var data = buildElementData(el);
    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;

    var left = x + 10;
    var top = y + 10;
    if (left + 340 > viewportWidth) left = x - 350;
    if (top + 280 > viewportHeight) top = y - 290;
    if (left < 8) left = 8;
    if (top < 8) top = 8;

    var popup = document.createElement('div');
    popup.id = '__fox-popup';
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';

    var tagDisplay = data.tag + (data.id ? '#' + data.id : (data.className ? '.' + data.className.split(' ')[0] : ''));

    popup.innerHTML =
      '<div class="__fox-tag">Element: <span>' + tagDisplay + '</span></div>' +
      '<div class="__fox-selector">' + data.xpath + '</div>' +
      '<textarea placeholder="What\'s wrong with this element?"></textarea>' +
      '<div class="__fox-hint">Sending to: ' + (window.__foxSessionTitle || window.__foxSessionId || 'none') + '. To target a different session, close this, navigate to that session in OpenFox, and reopen the inspect window.</div>' +
      '<div class="__fox-actions">' +
        '<button class="__fox-cancel">Cancel</button>' +
        '<button class="__fox-send">Send to Agent</button>' +
      '</div>';

    document.body.appendChild(popup);

    var textarea = popup.querySelector('textarea');
    textarea.focus();

    textarea.addEventListener('keydown', function(ke) {
      if (ke.key === 'Enter' && !ke.shiftKey) {
        ke.preventDefault();
        popup.querySelector('.__fox-send').click();
      }
    });

    popup.querySelector('.__fox-cancel').addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      window.__foxPopupOpen = false;
      popup.remove();
    });

    popup.querySelector('.__fox-send').addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__foxSentPending) return;
      window.__foxSentPending = true;
      setTimeout(function() { window.__foxSentPending = false; }, 3000);
      var annotation = textarea.value.trim();
      window.__foxPopupOpen = false;
      popup.remove();
      clearHighlights();
      setInspectMode(false);

      fetch('/__openfox_feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: window.__foxSessionId,
          element: data,
          annotation: annotation,
          pageUrl: window.location.href
        })
      }).catch(function(err) {
        console.error('Failed to send feedback:', err);
      });
    });

    popup.addEventListener('click', function(e) { e.stopPropagation(); });

    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        window.__foxPopupOpen = false;
        popup.remove();
        clearHighlights();
        setInspectMode(false);
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  document.addEventListener('mouseover', function(e) {
    if (!window.__foxInspectMode || window.__foxPopupOpen) return;
    if (e.target === document.documentElement || e.target === document.body) return;
    if (overlay.contains(e.target)) return;
    clearHighlights();
    e.target.classList.add('__fox-highlight');
    window.__foxHighlightedEl = e.target;
  }, true);

  document.addEventListener('click', function(e) {
    if (!window.__foxInspectMode) return;
    if (overlay.contains(e.target)) return;
    if (document.getElementById('__fox-popup')) return;

    e.preventDefault();
    e.stopPropagation();
    var el = window.__foxHighlightedEl;
    if (!el) return;
    showPopup(el, e.clientX, e.clientY);
  }, true);

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && window.__foxInspectMode) {
      clearHighlights();
      setInspectMode(false);
    }
    if (e.ctrlKey && e.shiftKey && e.key === 'X') {
      e.preventDefault();
      if (window.__foxInspectMode) clearHighlights();
      setInspectMode(!window.__foxInspectMode);
    }
  });

  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'setFoxSessionId') {
      window.__foxSessionId = e.data.sessionId;
    }
    if (e.data && e.data.type === 'setFoxSessionTitle') {
      window.__foxSessionTitle = e.data.sessionTitle;
    }
    if (e.data && e.data.type === 'setFoxInspectEnabled') {
      window.__foxInspectEnabled = e.data.enabled;
      overlay.style.display = e.data.enabled ? '' : 'none';
    }
  });

  function init() {
    if (window.__foxInspectInit) return;
    window.__foxInspectInit = true;
    document.head.appendChild(overlayStyle);
    document.body.appendChild(overlay);
    toggleBtn = document.getElementById('__fox-toggle');
    var widget = document.getElementById('__fox-widget');
    widget.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
    }, true);
    toggleBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.__foxInspectMode) clearHighlights();
      setInspectMode(!window.__foxInspectMode);
    });
    overlay.style.display = window.__foxInspectEnabled ? '' : 'none';
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
})();
