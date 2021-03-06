angular.module('sisui')
.controller("EntityDescriptorController", function($scope, SisUtil, SisApi,
                                                   $modal, $log) {
    "use strict";
    // the container object we are managing a field of
    // $scope.container

    // the description of the field we are managing
    // if we are managing an entry in an array, it is
    // a descriptor that indicates the type of elements
    // in the array
    // $scope.fieldDescriptor

    // the array index of the item we are managing
    // IF the container is an array
    // use undefined since isNaN(undefined) == true while
    // isNaN(null) == false
    // $scope.arrIdx = undefined;

    // get the field that this controller is managing
    // from the parent value
    var initializeFieldValue = function() {

        var arrIdx = $scope.arrIdx;
        var container = $scope.container;
        var fieldDescriptor = $scope.fieldDescriptor;

        if (!isNaN(arrIdx)) {
            // we are managing an entry in an array
            // container is the actual array
            // fieldDescriptor is the type of elements in the array
            // and arrIdx is the index of our initial value
            if (arrIdx < container.length) {
                $scope.fieldValue = container[arrIdx];
            } else {
                // this should never happen if our templates
                // are setup right
                $scope.fieldValue = SisUtil.getNewItemForDesc(fieldDescriptor);
                container[arrIdx] = $scope.fieldValue;
            }
            $scope.fieldName = arrIdx;
        } else {
            // the container is a document
            var fieldName = fieldDescriptor.name;
            if (fieldName in container) {
                $scope.fieldValue = container[fieldName];
            } else {
                $scope.fieldValue = SisUtil.getNewItemForDesc(fieldDescriptor);
                container[fieldName] = $scope.fieldValue;
            }
            $scope.fieldName = fieldName;
        }
        if (fieldDescriptor.type === "Mixed" &&
            typeof $scope.fieldValue === "object") {
            $scope.fieldValue = angular.toJson($scope.fieldValue);
        } else if (fieldDescriptor.type == "IpAddress" &&
            typeof $scope.fieldValue === "object") {
            var addrString = $scope.fieldValue.ip_address + "/" + $scope.fieldValue.cidr;
            $scope.fieldValue = addrString;
        }
        // special owner handling
        if (fieldDescriptor.path == "_sis.owner" &&
            fieldDescriptor.type == "String" && !$scope.fieldValue.length) {
            $scope.fieldValue = "";
        }
    };

    // set up the controller after init has been called
    var setupScope = function() {
        var fieldDescriptor = $scope.fieldDescriptor;
        var paths = SisUtil.getDescriptorPath(fieldDescriptor);
        var arrIdx = $scope.arrIdx;
        if (!isNaN(arrIdx)) {
            paths.push(arrIdx);
        }
        $scope.path = paths.join(".");
        if (fieldDescriptor.type == "Array") {
            // fieldValue is an array
            // children is a single element descriptor
            // array
            $scope.children = fieldDescriptor.children;
        } else if (fieldDescriptor.type == "Document") {
            // fieldValue is a document
            $scope.children = fieldDescriptor.children;
        } else if (fieldDescriptor.type == "ObjectId") {
            if (fieldDescriptor.ref) {
                // get the schema and list of entities to show
                SisApi.schemas.get(fieldDescriptor.ref).then(function(schema) {
                    $scope.refSchema = schema;
                    var idField = SisUtil.getIdField(schema);
                    var fields = '_id';
                    if (idField != '_id') {
                        fields += "," + idField;
                    }
                    $scope.refIdField = idField;
                    if ($scope.fieldValue) {
                        $scope.fieldValue = $scope.fieldValue._id || $scope.fieldValue;
                        $scope.valueChanged($scope.fieldValue);
                        SisApi.entities(schema.name).get($scope.fieldValue).then(function(entity) {
                            $scope.fieldValue = entity[idField];
                            $scope.valueChanged(entity);
                        }, function(err) {
                            $scope.fieldValue = null;
                            $scope.valueChanged(null);
                        });
                    }
                });
            }
        }
    };

    $scope.chooseEntity = function() {
        if (!$scope.refSchema) {
            return;
        }
        var scope = $scope.$new(true);
        scope.schema = $scope.refSchema;
        scope.idField = $scope.refIdField;
        var modal = $modal.open({
            templateUrl : "app/partials/entity-chooser.html",
            scope : scope,
            controller : "EntityChooserController",
            windowClass : "wide-modal-window"
        });
        modal.result.then(function(entity) {
            if (!entity) {
                $scope.fieldValue = null;
            } else {
                $scope.fieldValue = entity[$scope.refIdField];
            }
            $scope.valueChanged(entity);
        });
    };

    $scope.inputType = function() {
        return SisUtil.getInputType($scope.fieldDescriptor.type);
    };

    $scope.toggleChoice = function(choice) {
        var idx = $scope.fieldValue.indexOf(choice);
        if (idx == -1) {
            $scope.fieldValue.push(choice);
        } else {
            $scope.fieldValue.splice(idx, 1);
        }
    };

    // called on the array itself
    $scope.addItem = function() {
        var fieldDescriptor = $scope.fieldDescriptor;
        var itemDesc = fieldDescriptor.children[0];
        var item = SisUtil.getNewItemForDesc(itemDesc);
        $scope.fieldValue.push(item);
    };

    // called on an item within an array
    $scope.delItem = function(idx) {
        if (!$scope.isItem()) {
            return;
        }
        var container = $scope.container;
        if (idx >= 0 && idx < container.length) {
            container.splice(idx, 1);
        }
    };

    // called on an item to see if it is in an array
    $scope.isItem = function() {
        var container = $scope.container;
        var arrIdx = $scope.arrIdx;
        return !isNaN(arrIdx) && container instanceof Array;
    };

    $scope.canDelete = function() {
        return $scope.action !== "view" && $scope.isItem();
    };

    $scope.canAdd = function() {
        if ($scope.action == "view") {
            return false;
        }
        return ($scope.fieldValue instanceof Array);
    };

    $scope.getErrorMsg = function(field) {
        for (var k in field.$error) {
            if (field.$error[k]) {
                if ($scope.descriptor[k]) {
                    return "Invalid : (" + k + " - " + $scope.descriptor[k] + ")";
                }
                return "Invalid : (" + k + ")";
            }
        }
        return "";
    };

    // Dirty hack.  Better way would be to make binding fieldValue
    // and propagating that up without ngChange
    // TODO: debug why binding w/ ng-model only didn't work.
    $scope.valueChanged = function(value) {
        if ($scope.fieldDescriptor.type == "ObjectId" &&
            $scope.fieldDescriptor.ref) {
            if (!value) {
                value = null;
            } else if (typeof value === 'object') {
                value = value._id;
            }
            $scope.refId = value;
        } else if ($scope.fieldDescriptor.type == "Mixed" &&
            typeof value === "string") {
                try {
                    value = angular.fromJson(value);
                } catch (ex) {
                    value = null;
                }
        } else if ($scope.path == "_sis.owner" &&
            $scope.fieldDescriptor.type == "String") {
            value = SisUtil.toStringArray(value);
        } else if ($scope.path == "_sis.tags") {
            value = SisUtil.toStringArray(value);
        }
        if ($scope.isItem()) {
            $scope.$parent.fieldValue[$scope.arrIdx] = value;
        } else {
            $scope.$parent.fieldValue[$scope.fieldName] = value;
        }
        if ($scope.$parent.valueChanged) {
            $scope.$parent.valueChanged($scope.$parent.fieldValue);
        }
    };

    $scope.isReadOnly = function() {
        var descriptor = $scope.fieldDescriptor;
        var isCode = (descriptor.type == "Mixed" ||
            (descriptor.code && descriptor.type == "String"));
        return $scope.action == 'view' && !isCode;
    };

    $scope.fieldValue = "<NOT_SET>";

    // initialize a controller where value is a
    // container object (document or array),
    // descriptor is a field of the container that is managed
    // and arrIdx is the index of the array container if value
    // is an array
    $scope.init = function(c, d, aIdx) {
        $scope.container = c;
        $scope.fieldDescriptor = d;
        $scope.arrIdx = aIdx;
        $scope.isCollapsed = false;
        initializeFieldValue();
        setupScope();
        if ($scope.fieldValue instanceof Array) {
            $scope.lastModTime = Date.now();
            // watch it
            $scope.$watch("fieldValue.length", function() {
                $scope.lastModTime = Date.now();
            });
        }
    };

});
