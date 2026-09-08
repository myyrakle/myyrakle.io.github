(function (root) {
  var searchReady;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function highlight(text, query) {
    var escaped = escapeHtml(text);
    var terms = String(query || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(escapeRegExp);

    if (!terms.length) {
      return escaped;
    }

    return escaped.replace(new RegExp("(" + terms.join("|") + ")", "gi"), "<mark>$1</mark>");
  }

  function createExcerpt(body, query, maxLength) {
    var text = String(body || "").replace(/\s+/g, " ").trim();
    var limit = maxLength || 160;

    if (text.length <= limit) {
      return highlight(text, query);
    }

    var lowerText = text.toLowerCase();
    var lowerQuery = String(query || "").trim().toLowerCase();
    var firstTerm = lowerQuery.split(/\s+/).filter(Boolean)[0] || "";
    var matchIndex = firstTerm ? lowerText.indexOf(firstTerm) : -1;
    var start = matchIndex > -1 ? Math.max(0, matchIndex - Math.floor(limit / 3)) : 0;
    var end = Math.min(text.length, start + limit);
    var excerpt = text.slice(start, end);

    if (start > 0) {
      excerpt = "..." + excerpt;
    }
    if (end < text.length) {
      excerpt += "...";
    }

    return highlight(excerpt, query);
  }

  function resultDocument(result) {
    return result.doc || result.document || {};
  }

  function renderResults(results, query) {
    if (!results.length) {
      return "";
    }

    return results.map(function (result) {
      var doc = resultDocument(result);
      var title = doc.title || result.ref;
      var body = doc.body || "";

      return [
        '<li class="zola-search-result">',
        '<a href="' + escapeHtml(result.ref) + '">' + highlight(title, query) + "</a>",
        "<p>" + createExcerpt(body, query, 170) + "</p>",
        "</li>",
      ].join("");
    }).join("");
  }

  function registerPipelineFunction(elasticlunr, label, fn) {
    if (elasticlunr.Pipeline.registeredFunctions && elasticlunr.Pipeline.registeredFunctions[label]) {
      return;
    }
    elasticlunr.Pipeline.registerFunction(fn, label);
  }

  function registerKoreanPipeline(elasticlunr) {
    var trimmer = function (token) {
      if (token === null || token === undefined) {
        throw new Error("token should not be undefined");
      }
      return String(token)
        .replace(/^[^A-Za-z\uac00-\ud7a3]+/, "")
        .replace(/[^A-Za-z\uac00-\ud7a3]+$/, "");
    };
    var passthrough = function (token) {
      return token;
    };

    registerPipelineFunction(elasticlunr, "trimmer-ko", trimmer);
    registerPipelineFunction(elasticlunr, "stopWordFilter-ko", passthrough);
    registerPipelineFunction(elasticlunr, "stemmer-ko", passthrough);
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = function () {
        reject(new Error("Failed to load " + src));
      };
      document.head.appendChild(script);
    });
  }

  function loadSearch(rootElement) {
    if (searchReady) {
      return searchReady;
    }

    var libraryUrl = rootElement.getAttribute("data-search-library-url") || "/elasticlunr.min.js";
    var indexUrl = rootElement.getAttribute("data-search-index-url") || "/search_index.ko.json";

    searchReady = loadScript(libraryUrl)
      .then(function () {
        var elasticlunr = root.elasticlunr;
        registerKoreanPipeline(elasticlunr);
        return fetch(indexUrl);
      })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load " + indexUrl);
        }
        return response.json();
      })
      .then(function (searchIndex) {
        return root.elasticlunr.Index.load(searchIndex);
      });

    return searchReady;
  }

  function initSearchRoot(rootElement) {
    var input = rootElement.querySelector("[data-search-input]");
    var form = rootElement.querySelector("[data-search-form]");
    var summary = rootElement.querySelector("[data-search-summary]");
    var resultsElement = rootElement.querySelector("[data-search-results]");
    var debounceTimer;

    if (!input || !summary || !resultsElement) {
      return;
    }

    function setSummary(message, isError) {
      summary.textContent = message;
      summary.classList.toggle("zola-search-error", Boolean(isError));
    }

    function runSearch() {
      var query = input.value.trim();

      if (query.length < 2) {
        resultsElement.innerHTML = "";
        setSummary("Type at least 2 characters.");
        return;
      }

      setSummary("Loading search index...");
      loadSearch(rootElement)
        .then(function (index) {
          var results = index.search(query, {
            fields: {
              title: { boost: 2 },
              body: { boost: 1 },
            },
            expand: true,
          }).slice(0, 10);

          resultsElement.innerHTML = renderResults(results, query);
          setSummary(results.length ? results.length + " results" : "No results");
        })
        .catch(function (error) {
          resultsElement.innerHTML = "";
          setSummary(error.message || "Search failed.", true);
        });
    }

    input.addEventListener("input", function () {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runSearch, 160);
    });

    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        window.clearTimeout(debounceTimer);
        runSearch();
      });
    }
  }

  function focusSearchInput(dialog) {
    var input = dialog.querySelector("[data-search-input]");
    if (input) {
      input.focus();
    }
  }

  function initSearchOverlay() {
    var dialog = document.querySelector("[data-search-dialog]");
    var buttons = document.querySelectorAll("[data-search-open]");
    var closeButtons = document.querySelectorAll("[data-search-close]");

    document.querySelectorAll("[data-search-root]").forEach(initSearchRoot);

    if (!dialog || typeof dialog.showModal !== "function") {
      return;
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        if (!dialog.open) {
          dialog.showModal();
        }
        window.setTimeout(function () {
          focusSearchInput(dialog);
        }, 100);
      });
    });

    closeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        dialog.close();
      });
    });

    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        dialog.close();
      }
    });
  }

  root.ZolaSearchOverlay = {
    createExcerpt: createExcerpt,
    registerKoreanPipeline: registerKoreanPipeline,
    renderResults: renderResults,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSearchOverlay);
  } else {
    initSearchOverlay();
  }
})(window);
