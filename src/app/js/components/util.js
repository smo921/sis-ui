// Utility methods - TODO refactor
angular.module('sisui')
.factory('SisUtil', function($window, $state, SisUser,
                             $q, SisQueryParser) {
    "use strict";

    // Pager class
    function EndpointPager(endpoint, scope, opts) {

        var convertParsedToQueryObj = function(parsed) {
            var left = parsed[0];
            var right = parsed[2];
            var op = parsed[1].toLowerCase();
            var result = { };
            if (left instanceof Array ||
                right instanceof Array) {
                // op is or/and
                left = convertParsedToQueryObj(left);
                right = convertParsedToQueryObj(right);
                op = '$' + op;
                result[op] = [left, right];
            } else {
                // at a leaf
                if (!isNaN(right)) {
                    right = parseFloat(right);
                }
                var opMap = {
                    ">=" : "$gte",
                    "<=" : "$lte",
                    "<" : "$lt",
                    ">" : "$gt",
                    "!=" : "$ne"
                };
                if (op in opMap) {
                    // { field : { op : val }}
                    var rightOp = {}; rightOp[opMap[op]] = right;
                    result[left] = rightOp;
                } else if (op == "nin" || op == "in") {
                    right = right.split(",").map(function(s) {
                        s = s.trim();
                        if (!isNaN(s)) {
                            s = parseFloat(s);
                        }
                        return s;
                    });
                } else if (op == "like") {
                    result[left] = { $regex : right, $options : "i" };
                } else {
                    // equal
                    result[left] = right;
                }
            }
            return result;
        };

        this.parseSearch = function(search) {
            if (!search) {
                return null;
            }
            if (typeof search === 'object') {
                return search;
            }
            try {
                var parsed = SisQueryParser.parse(search);
                return convertParsedToQueryObj(parsed);
            } catch (ex) {
                return null;
            }
            return null;
        };

        var self = this;
        // init
        scope.totalItems = 0;
        scope.currentPage = 1;
        // opts/defaults
        opts = opts || { };
        scope.pageSize = opts.pageSize || 20;
        var sortField = opts.sortField || null;
        var fields = opts.fields || null;
        var searchQuery = this.parseSearch(opts.search);
        var itemsField = opts.itemsField || 'items';
        var idField = opts.idField || 'name';

        this.endpoint = endpoint;

        this.setSearch = function(search) {
            searchQuery = this.parseSearch(search);
            if (searchQuery) {
                // set page to 1
                this.setPage(1);
            }
            this.loadPage();
        };

        this.setSort = function(sort) {
            sortField = sort;
            this.loadPage();
        };

        this.loadPage = function() {
            var query = {
                limit : scope.pageSize,
                offset: (scope.currentPage - 1) * scope.pageSize
            };
            if (sortField) {
                query.sort = sortField;
            }
            if (fields) {
                query.fields = fields;
            }
            if (searchQuery) {
                query.q = searchQuery;
            }
            endpoint.list(query).then(function(items) {
                scope.totalItems = items.total_count;
                scope[itemsField] = items.results;
            });
        };

        // attach some scope methods
        this.setPage = function(pageNum) {
            scope.currentPage = pageNum;
        };

        this.remove = function(item) {
            var d = $q.defer();
            endpoint.delete(item).then(function(res) {
                var items = scope[itemsField];
                var itemId = item[idField];
                for (var i = 0; i < items.length; ++i) {
                    if (items[i][idField] == itemId) {
                        items.splice(i, 1);
                        break;
                    }
                }
                d.resolve(res);
            }, function(err) {
                d.reject(err);
            });
            return d.promise;
        };

        scope.$watch('currentPage', function(newVal, oldVal) {
            if (newVal != oldVal || !scope[itemsField]) {
                self.loadPage();
            }
        });
        scope.setPage = this.setPage.bind(this);

        // add the filter method
        scope.filter = function(text) {
            if (!text) {
                self.setSearch(text);
                return;
            }
            var parsed = self.parseSearch(text);
            if (!parsed) {
                scope.filterError = "invalid query";
            } else {
                scope.filterError = null;
                self.setSearch(parsed);
            }
        };
    }

    // add some utilities to the client
    function getArrayDescriptor(arr, name) {
        var res = {
            type : "Array"
        };
        if (arr.length && arr[0]) {
            res.children = [normalizeDescriptor(arr[0], null)];
            if (res.children[0].enum) {
                res.enum = res.children[0].enum;
                delete res.children[0].enum;
            }
        } else {
            res.children = [{ "type" : "Mixed" }];
        }
        if (name) {
            res.name = name;
        }
        res.children.forEach(function(c) {
            c._parent_ = res;
        });
        return res;
    }

    function fixChildren(desc) {
        desc.children.forEach(function(c) {
            c._parent_ = desc;
        });
        desc.children.sort(function(c1, c2) {
            if (c1.name < c2.name) { return -1 ;}
            else if (c1.name > c2.name) { return 1 ;}
            return 0;
        });
    }

    function normalizeDescriptor(desc, name) {
        var k, inner = null;
        if (desc instanceof Array) {
            return getArrayDescriptor(desc, name);
        } else if (typeof desc === "string") {
            return { type : desc, name : name };
        } else if ('type' in desc) {
            if (typeof desc.type === "string") {
                var result = {
                    name : name
                };
                for (k in desc) {
                    result[k] = desc[k];
                }
                if (desc.type == "ObjectId" && desc.ref) {
                    result.type = desc.type;
                    result.ref = desc.ref;
                }
                return result;
            } else {
                // check if it's an array
                if (desc.type instanceof Array) {
                    inner = getArrayDescriptor(desc.type, name);
                    for (k in desc) {
                        if (k != 'type') {
                            inner[k] = desc[k];
                        }
                    }
                    return inner;
                } else {
                    // desc.type is an object
                    if (typeof desc.type.type === "string") {
                        // this implies that desc.type
                        // is a descriptor and desc itself
                        // is an embedded schema
                        inner = {
                            name : name,
                            type : "Document",
                            children : getDescriptors(desc)
                        };
                        fixChildren(inner);
                        return inner;
                    } else {
                        // desc.type is the embedded schema
                        // definition
                        inner = {
                            name : name,
                            type : "Document",
                            children : getDescriptors(desc.type)
                        };
                        fixChildren(inner);
                        for (k in desc) {
                            if (k != 'type') {
                                inner[k] = desc[k];
                            }
                        }
                        return inner;
                    }
                }
            }
        } else {
            // embedded scema
            inner = {
                name : name,
                type : "Document",
                children : getDescriptors(desc)
            };
            inner.children.map(function(c) {
                c._parent_ = inner;
            });
            return inner;
        }
    }

    function _getPathForDesc(desc) {
        var paths = [];
        while (desc) {
            if (desc.name) {
                paths.push(desc.name);
            } else {
                paths.push('_0');
            }
            desc = desc._parent_;
        }
        paths.reverse();
        return paths;
    }

    function getDescriptorToJSON(desc) {
        return function() {
            var result = { };
            for (var k in desc) {
                if (k != 'toJSON' && k != '_parent_') {
                    result[k] = desc[k];
                }
            }
            return result;
        };
    }

    function getDescriptors(defn) {
        if (!defn) { return []; }
        var result = [];
        for (var k in defn) {
            var desc = defn[k];
            var normalized = normalizeDescriptor(desc, k);
            normalized.toJSON = getDescriptorToJSON(desc);
            result.push(normalized);
        }
        result.sort(function(c1, c2) {
            if (c1.name < c2.name) { return -1 ;}
            else if (c1.name > c2.name) { return 1 ;}
            return 0;
        });
        return result;
    }

    var _canAddEntityForSchema = function(schema) {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return false;
        }
        if (user.super_user) { return true; }
        var roles = user.roles || { };
        if (!Object.keys(roles).length) {
            return false;
        }
        if (schema.is_open || schema.is_public) {
            return true;
        }
        var owner = schema._sis.owner;
        for (var i = 0; i < owner.length; ++i) {
            if (owner[i] in roles) {
                return true;
            }
        }
        return false;
    };

    var _getAdminRoles = function() {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return null;
        }
        if (user.super_user) {
            return true;
        }
        var roles = user.roles || { };
        var result = [];
        for (var k in roles) {
            if (roles[k] == 'admin') {
                result.push(k);
            }
        }
        return result;
    };

    var _getAllRoles = function() {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return [];
        }
        if (user.super_user) {
            return true;
        }
        var roles = user.roles || { };
        return Object.keys(roles);
    };

    var _getOwnerSubset = function(schema) {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return [];
        }
        if (user.super_user) {
            return schema._sis.owner;
        }
        var roles = user.roles || { };
        var subset = schema._sis.owner.filter(function(o) {
            return o in roles;
        });
        return subset;
    };

    var _canDelete = function(obj) {
        return obj && !(obj._sis && obj._sis.locked);
    };

    var _canManageEntity = function(entity, schema) {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return false;
        }
        if (user.super_user) { return true; }
        var roles = user.roles || { };
        var owner = entity._sis ? entity._sis.owner : schema._sis.owner;
        for (var i = 0; i < owner.length; ++i) {
            var group = owner[i];
            if (!roles[group]) {
                return false;
            }
        }
        return true;
    };

    var _canManageSchema = function(schema) {
        var user = SisUser.getCurrentUser();
        if (!user) {
            return false;
        }
        if (user.super_user) { return true; }
        if (schema.is_open) { return true; }
        var roles = user.roles || { };
        var numAdminRoles = 0;
        var owners = schema._sis.owner;
        for (var i = 0; i < owners.length; ++i) {
            var group = owners[i];
            if (roles[group] == 'admin') {
                numAdminRoles++;
            }
        }
        return (numAdminRoles == owners.length ||
                numAdminRoles > 0 && schema.any_owner_can_modify);
    };

    var _getIdField = function(schema) {
        var defn = schema.definition;
        for (var k in defn) {
            if (typeof defn[k] === 'object') {
                var descriptor = defn[k];
                if (typeof(descriptor.type) === "string" &&
                    descriptor.type == "String" &&
                    descriptor.required &&
                    descriptor.unique) {
                    // found a required, unique string
                    return k;
                }
            }
        }
        var result = "_id";
        if ('name' in defn) {
            result = "name";
        } else if ("title" in defn) {
            result = "title";
        }
        return result;
    };

    var _getNewItemForDesc = function(desc) {
        if (desc.type == "Document") {
            return { };
        } else if (desc.type == "Array") {
            return [];
        } else if (desc.enum && desc.enum.length) {
            return desc.enum[0];
        } else if (desc.type == "ObjectId") {
            return null;
        } else {
            return "";
        }
    };

    var _getInputType = function(type) {
        switch (type) {
            case "Boolean":
                return "checkbox";
            case "Number":
                return "number";
            default:
                return "text";
        }
    };

    var _descriptorTypes = ["Boolean", "String", "Number", "Mixed",
                            "Document", "Array", "ObjectId", "IpAddress"];

    var attrsCache = { };

    var _getAttributesForType = function(type) {
        if (attrsCache[type]) {
            return attrsCache[type];
        }
        var result = [
            {name : 'required', type : 'checkbox'},
            {name : 'unique', type : 'checkbox'},
            {name : 'comment', type : 'text'}
        ];
        switch (type) {
            case "Number":
                result.push({ name : "min", type : "number" });
                result.push({ name : "max", type : "number" });
                break;
            case "String":
                result.push({ name : "lowercase", type : "checkbox" });
                result.push({ name : "trim", type : "checkbox" });
                result.push({ name : "uppercase", type : "checkbox" });
                result.push({ name : "enum", type : "textArray" });
                result.push({ name : "match", type : "regex" });
                result.push({ name : "code", type : "text" });
                break;
            case "ObjectId":
                result.push({ name : "ref", type : "select", values : "schemaList" });
                break;
            default:
                break;
        }
        attrsCache[type] = result;
        return result;
    };

    var _getHookSchema = function() {
        return {
            name : "sis_hooks",
            _sis : {
                owner : _getAllRoles()
            },
            definition : {
                name : { type : "String", required : true, unique : true, match : '/^[0-9a-z_]+$/' },
                target : {
                        type : {
                            url : { type : "String", required : true },
                            action : { type : "String", required : true, enum : ["GET", "POST", "PUT"]}
                        },
                        required : true
                },
                retry_count : { type : "Number", min : 0, max : 20, "default" : 0 },
                retry_delay : { type : "Number", min : 1, max : 60, "default" : 1 },
                events : { type : [{ type : "String", enum : ["insert", "update", "delete"] }], required : true },
                entity_type : { type : "String", required : true }
            }
        };
    };

    var _goBack = function(state) {
        if ($window.history.length) {
            $window.history.back();
        } else {
            $state.go(state);
        }
    };

    var _toRegex = function(str) {
        try {
            if (str instanceof RegExp) {
                return str;
            }
            if (!str || str[0] != '/') {
                return null;
            }
            var splits = str.split('/');
            if (splits.length < 3 || splits[0]) {
                return null;
            }
            var flags = splits.pop();
            splits.shift();
            var regex = splits.join("/");
            if (!regex) {
                return null;
            }
            return new RegExp(regex, flags);
        } catch(ex) {
        }
        return null;
    };

    var _getSisMetaDescriptor = function() {
        var children = [
            { name : "locked", type : "Boolean" },
            { name : "immutable", type : "Boolean" },
            { name : "tags", type : "String" },
            { name : "owner", type : ["String"] }
        ];
        var meta = {
            name : '_sis', type : 'Document', children : children
        };
        meta.children.forEach(function(c) {
            c._parent_ = meta;
        });
        return meta;
    };

    var _toStringArray = function(text) {
        if (text instanceof Array) {
            return text;
        }
        return text.split(",").map(function(str) {
            return str.trim();
        }).filter(function(str) {
            return str !== "";
        });
    };

    return {
        getDescriptorArray : function(schema) {
            return getDescriptors(schema.definition);
        },
        getIdField : _getIdField,
        canManageEntity : _canManageEntity,
        canManageSchema : _canManageSchema,
        canAddEntity : _canAddEntityForSchema,
        getDescriptorPath : _getPathForDesc,
        getNewItemForDesc : _getNewItemForDesc,
        canDelete : _canDelete,
        getOwnerSubset : _getOwnerSubset,
        getAdminRoles : _getAdminRoles,
        getAllRoles : _getAllRoles,
        getInputType : _getInputType,
        descriptorTypes : _descriptorTypes,
        attributesForType : _getAttributesForType,
        getHookSchema : _getHookSchema,
        EndpointPager : EndpointPager,
        goBack : _goBack,
        toRegex : _toRegex,
        getSisMetaDescriptor : _getSisMetaDescriptor,
        toStringArray : _toStringArray
    };
});
