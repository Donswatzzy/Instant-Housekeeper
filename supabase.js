/*! For license information please see supabase.js.LICENSE.txt */
(function(global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
    typeof define === 'function' && define.amd ? define(['exports'], factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.supabase = {}));
})(this, (function(exports) { 'use strict';
    // Minimal Polyfill and Core Interface Mock for client library loading
    var SupabaseClient = function(url, key, options) {
        this.supabaseUrl = url;
        this.supabaseKey = key;
        this.auth = { session: function() { return null; }, onAuthStateChange: function() {} };
    };
    SupabaseClient.prototype.from = function(table) {
        var url = this.supabaseUrl + '/rest/v1/' + table;
        var key = this.supabaseKey;
        var builder = {
            select: function() { return this; },
            eq: function() { return this; },
            maybeSingle: function() { return this; },
            then: function(onfulfilled) {
                fetch(url, { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } })
                .then(function(r) { return r.json(); })
                .then(function(d) { onfulfilled({ data: d, error: null }); })
                .catch(function(e) { onfulfilled({ data: null, error: e }); });
            }
        };
        return builder;
    };
    exports.createClient = function(url, key, options) {
        return new SupabaseClient(url, key, options);
    };
}));
