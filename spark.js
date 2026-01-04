/* SPARK FRAMEWORK v0.5
 * - Multi-page router
 * - Unified SparkButton + SparkLink
 * - Tiny global store & helpers
 */

(function () {

    // --- 1. GLOBAL REGISTRY & ROUTER --------------------------------------

    window.$sparkApps = window.$sparkApps || [];

    const SparkRouter = {
        currentRoute: null,

        // Normalize something like "about" / "#about" / "/about" into "#/about"
        normalize(hash) {
            if (!hash) hash = window.location.hash || "#/";
            if (!hash.startsWith("#")) hash = "#" + hash;
            if (!hash.startsWith("#/")) {
                // e.g. "#about" -> "#/about"
                hash = "#/" + hash.slice(1).replace(/^\/?/, "");
            }
            return hash;
        },

        pathFromHash(hash) {
            hash = this.normalize(hash);
            return hash.slice(1); // remove "#"
        },

        matchRoute(routeConfig, currentHash) {
            if (!routeConfig) return true; // No route = always visible

            currentHash = this.normalize(currentHash);
            const currentPath = this.pathFromHash(currentHash);

            // String route: exact match
            if (typeof routeConfig === "string") {
                const targetPath = this.pathFromHash(routeConfig);
                return currentPath === targetPath;
            }

            // Function route: user decides
            if (typeof routeConfig === "function") {
                return !!routeConfig(currentHash);
            }

            return false;
        },

        updateAll() {
            this.currentRoute = this.normalize(window.location.hash || "#/");
            window.$sparkApps.forEach(app => {
                if (typeof app._onRouteChange === "function") {
                    app._onRouteChange(this.currentRoute);
                }
                if (typeof app._updateUI === "function") {
                    app._updateUI();
                }
            });
        },

        navigate(hash) {
            const target = this.normalize(hash);
            if (window.location.hash === target) {
                // Force update even if same hash
                this.updateAll();
            } else {
                window.location.hash = target;
            }
        },

        init() {
            this.currentRoute = this.normalize(window.location.hash || "#/");
            window.addEventListener("hashchange", () => {
                this.updateAll();
            });
            // First run
            this.updateAll();
        }
    };

    window.$sparkRouter = SparkRouter;

    // --- 2. ROUTER HELPERS (GLOBAL) ---------------------------------------

    window.SparkNavigate = function (target) {
        if (!target) return;
        if (typeof target === "string" && target.startsWith("#") && window.$sparkRouter) {
            window.$sparkRouter.navigate(target);
        } else {
            // full URL or relative URL
            window.location.href = target;
        }
    };

    window.SparkBack = function (fallback) {
        if (window.history.length > 1) {
            window.history.back();
        } else if (fallback) {
            if (fallback.startsWith("#") && window.$sparkRouter) {
                window.$sparkRouter.navigate(fallback);
            } else {
                window.location.href = fallback;
            }
        }
    };

    // --- 3. TINY GLOBAL STORE ---------------------------------------------

    // Simple reactive store shared by components if they want it
    // Example usage inside Spark templates:
    //   window.$sparkStore.set("user", { name: "Alice" })
    //   window.$sparkStore.get("user")
    //   window.$sparkStore.subscribe(fn) -> fn(store) on any change
    const SparkStore = (function () {
        const data = {};
        const subscribers = [];

        function notify() {
            subscribers.forEach(fn => {
                try { fn(data); } catch (e) { console.error(e); }
            });
        }

        return {
            get(key) {
                return key ? data[key] : data;
            },
            set(key, value) {
                data[key] = value;
                notify();
            },
            update(key, updater) {
                data[key] = updater(data[key]);
                notify();
            },
            subscribe(fn) {
                if (typeof fn === "function") {
                    subscribers.push(fn);
                    // Return unsubscribe
                    return () => {
                        const idx = subscribers.indexOf(fn);
                        if (idx >= 0) subscribers.splice(idx, 1);
                    };
                }
            }
        };
    })();

    window.$sparkStore = SparkStore;

    // --- 4. CORE ENGINE (SparkComponent) -----------------------------------

    class SparkComponent {

        constructor() {
            this.state = {};
            this.route = null;   // optional, set via compile
            this.container = null;
        }

        _makeReactive(key, val) {
            let _val = val;
            const self = this;

            Object.defineProperty(this.state, key, {
                get() { return _val; },
                set(newVal) { _val = newVal; self._updateUI(); }
            });
        }

        _mount(id) {
            this.container = document.getElementById(id);
            if (!this.container) return;

            window.$sparkApps.push(this);
            this._updateUI();
        }

        _shouldRenderForRoute() {
            return SparkRouter.matchRoute(this.route, window.location.hash);
        }

        _updateUI() {
            if (!this.container) return;

            if (!this._shouldRenderForRoute()) {
                this.container.style.display = "none";
                return;
            }

            this.container.style.display = "block";
            if (typeof this.render === "function") {
                this.container.innerHTML = this.render();
            }
        }

        // optional; user-defined in subclass if needed
        _onRouteChange(_hash) {
            // override in components if needed
        }
    }

    window.SparkComponent = SparkComponent;

    // --- 5. COMPILER -------------------------------------------------------

    function compile(src) {
        let js = src

            // Component setup
            .replace(
                /component\s+(\w+)\s*\{/g,
                'class $1 extends SparkComponent { constructor() { super(); this._init(); } _init() {'
            )

            // ROUTE handling: route = "#/about"
            .replace(/route\s*=\s*"(.*?)"/g, 'this.route = "$1";')

            // View/render
            .replace(/view\s*\{/g, '} render() { return `')
            .replace(/\}\s*$/g, '`; } }')

            // State definitions (arrays/objects)
            .replace(
                /state\s+(\w+)\s*=\s*(\[.*?\]|\{.*?\})/gs,
                'this._makeReactive("$1", $2);'
            )
            // State definitions (primitives)
            .replace(
                /state\s+(\w+)\s*=\s*(.+)/g,
                'this._makeReactive("$1", $2);'
            )

            // Loops
            .replace(
                /\{each\s+(\w+)\s+as\s+(\w+)\}/g,
                '${ this.state.$1.map($2 => `'
            )
            .replace(/\{endeach\}/g, '`).join("") }')

            // Conditionals
            .replace(
                /\{if\s+(.*?)\}/g,
                '${ this.state.$1 ? `'
            )
            .replace(/\{endif\}/g, '` : "" }')

            // Event handlers (simple transformations)
            .replace(/on(\w+)="(.*?)"/g, (m, e, c) => {
                // keep $activeApp behavior for quick demos
                let fix = c
                    .replace(/(\w+)(\+\+|--|=)/g, 'window.$activeApp.state.$1$2')
                    .replace(/(\w+)\.push/g, 'window.$activeApp.state.$1.push')
                    .replace(/(\w+)\.pop/g, 'window.$activeApp.state.$1.pop');

                return `on${e}="${fix}; window.$activeApp._updateUI()"`;
            });

        // Variable interpolation
        js = js.replace(
            /\$\{(\w+)\}/g,
            '${this.state.$1 !== undefined ? this.state.$1 : $1}'
        );

        return js;
    }

    window.$sparkCompile = compile;

    // --- 6. DOM-LEVEL HELPERS (SparkShow etc.) -----------------------------

    /**
     * <spark-show route="#/about">
     *   ... visible only when route matches ...
     * </spark-show>
     */
    class SparkShow extends HTMLElement {
        connectedCallback() {
            this._route = this.getAttribute("route") || null;
            this.style.display = "none";
            this._updateVisibility = this._updateVisibility.bind(this);
            window.addEventListener("hashchange", this._updateVisibility);
            this._updateVisibility();
        }

        disconnectedCallback() {
            window.removeEventListener("hashchange", this._updateVisibility);
        }

        _updateVisibility() {
            const route = this._route;
            if (!route) {
                this.style.display = "";
                return;
            }
            const match = SparkRouter.matchRoute(route, window.location.hash);
            this.style.display = match ? "" : "none";
        }
    }

    if (!customElements.get("spark-show")) {
        customElements.define("spark-show", SparkShow);
    }

    // --- 7. UNIFIED SparkButton + SparkLink --------------------------------

    class SparkButton extends HTMLElement {

        constructor() {
            super();
            this._onClick = this._onClick.bind(this);
        }

        static get observedAttributes() {
            return ["disabled"];
        }

        connectedCallback() {
            if (this._initialized) return;
            this._initialized = true;

            // Base class for styling
            if (!this.classList.contains("spark-button")) {
                this.classList.add("spark-button");
            }

            // Ensure semantic role for accessibility
            if (!this.hasAttribute("role")) {
                this.setAttribute("role", "button");
            }
            if (!this.hasAttribute("tabindex")) {
                this.setAttribute("tabindex", "0");
            }

            this.addEventListener("click", this._onClick);
            this.addEventListener("keydown", (e) => {
                if (this.disabled) return;
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this._onClick(e);
                }
            });

            this._updateDisabledState();
        }

        disconnectedCallback() {
            this.removeEventListener("click", this._onClick);
        }

        attributeChangedCallback(name) {
            if (name === "disabled") {
                this._updateDisabledState();
            }
        }

        get action() {
            return (this.getAttribute("action") || "navigate").toLowerCase();
        }

        set action(val) {
            if (val == null) this.removeAttribute("action");
            else this.setAttribute("action", val);
        }

        get target() {
            return this.getAttribute("target") || this.getAttribute("to") || "";
        }

        set target(val) {
            if (val == null) this.removeAttribute("target");
            else this.setAttribute("target", val);
        }

        get fallback() {
            return this.getAttribute("fallback") || "";
        }

        set fallback(val) {
            if (val == null) this.removeAttribute("fallback");
            else this.setAttribute("fallback", val);
        }

        get disabled() {
            return this.hasAttribute("disabled");
        }

        set disabled(val) {
            if (val) this.setAttribute("disabled", "");
            else this.removeAttribute("disabled");
        }

        _updateDisabledState() {
            const isDisabled = this.disabled;
            this.setAttribute("aria-disabled", isDisabled ? "true" : "false");
            if (isDisabled) {
                this.classList.add("spark-button--disabled");
            } else {
                this.classList.remove("spark-button--disabled");
            }
        }

        _onClick(event) {
            if (this.disabled) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            const action = this.action;
            const target = this.target;
            const fallback = this.fallback;

            switch (action) {
                case "back":
                    this._doBack(fallback);
                    break;
                case "route":
                    this._doRoute(target);
                    break;
                case "navigate":
                default:
                    this._doNavigate(target);
                    break;
            }
        }

        _doNavigate(target) {
            if (!target) return;
            if (window.SparkNavigate) {
                window.SparkNavigate(target);
            } else {
                if (target.startsWith("#")) {
                    window.location.hash = target;
                } else {
                    window.location.href = target;
                }
            }
        }

        _doBack(fallback) {
            if (window.SparkBack) {
                window.SparkBack(fallback);
            } else {
                if (window.history.length > 1) {
                    window.history.back();
                } else if (fallback) {
                    if (fallback.startsWith("#")) {
                        window.location.hash = fallback;
                    } else {
                        window.location.href = fallback;
                    }
                }
            }
        }

        _doRoute(target) {
            if (!target) return;
            if (window.$sparkRouter) {
                const hash = target.startsWith("#")
                    ? target
                    : "#" + target.replace(/^\/?/, "/");
                window.$sparkRouter.navigate(hash);
            } else {
                this._doNavigate(target);
            }
        }
    }

    if (!customElements.get("spark-button")) {
        customElements.define("spark-button", SparkButton);
    }

    /**
     * SparkLink: semantic <a>-like component that uses the same logic as SparkButton
     * Example:
     *   <spark-link action="route" target="#/about">About</spark-link>
     */
    class SparkLink extends HTMLAnchorElement {

        constructor() {
            super();
            this._onClick = this._onClick.bind(this);
        }

        connectedCallback() {
            if (this._initialized) return;
            this._initialized = true;

            if (!this.classList.contains("spark-link")) {
                this.classList.add("spark-link");
            }

            this.addEventListener("click", this._onClick);
        }

        disconnectedCallback() {
            this.removeEventListener("click", this._onClick);
        }

        get action() {
            return (this.getAttribute("action") || "navigate").toLowerCase();
        }

        get targetSpark() {
            // use href or explicit target
            return this.getAttribute("target") || this.getAttribute("href") || "";
        }

        get fallback() {
            return this.getAttribute("fallback") || "";
        }

        _onClick(e) {
            const action = this.action;
            const target = this.targetSpark;
            const fallback = this.fallback;

            // Don't break middle click / new tab
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;

            e.preventDefault();

            switch (action) {
                case "back":
                    window.SparkBack ? window.SparkBack(fallback) : window.history.back();
                    break;
                case "route":
                    if (window.$sparkRouter) {
                        const hash = target.startsWith("#")
                            ? target
                            : "#" + target.replace(/^\/?/, "/");
                        window.$sparkRouter.navigate(hash);
                    } else {
                        window.location.href = target;
                    }
                    break;
                case "navigate":
                default:
                    if (window.SparkNavigate) {
                        window.SparkNavigate(target);
                    } else {
                        window.location.href = target;
                    }
                    break;
            }
        }
    }

    if (!customElements.get("spark-link")) {
        customElements.define("spark-link", SparkLink, { extends: "a" });
    }

    // --- 8. LOADER ---------------------------------------------------------

    document.addEventListener("DOMContentLoaded", () => {
        SparkRouter.init();

        document
            .querySelectorAll('script[type="text/spark"]')
            .forEach(s => {
                try {
                    let mountId = s.getAttribute("mount-id") || "root";
                    const compiled = compile(s.innerHTML);
                    const code = `${compiled}\n window.$activeApp = new App(); window.$activeApp._mount('${mountId}');`;
                    eval(code);
                } catch (e) {
                    console.error(e);
                }
            });
    });

})();