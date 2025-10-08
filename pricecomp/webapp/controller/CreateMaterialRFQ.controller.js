sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/ui/core/Fragment"
], function (Controller, JSONModel, Filter, FilterOperator, MessageBox, Fragment) {
    "use strict";

    return Controller.extend("com.pricecomp.pricecomp.controller.CreateMaterialRFQ", {

        onInit: function () {
            this.router = this.getOwnerComponent().getRouter();
            this.router.getRoute("RouteCreateMaterialRFQ").attachPatternMatched(this.onRouteMatched, this);
        },

        setModel: function (modelName, data) {
            this.getView().setModel(new JSONModel(data), modelName);
        },

        onRouteMatched: function () {
            const model = this.getOwnerComponent().getModel();

            // Initialize models
            this.setModel("itemsModel", { items: [] });
            this.setModel("suppliersModel", { suppliers: [] });

            // Create basic details context
            this.basicDetailsContext = model.createEntry("/ZC_RFQBasicDetails", {
                properties: {
                    projectName: "",
                    reference: "",
                    quotationDeadline: null,
                    Waers: "",
                    Zterm: "",
                    Inco1: "",
                    CompanyCode: "",
                    Ekorg: "",
                    Ekgrp: ""
                }
            });

            this.byId("idRFQBasicDetails").setBindingContext(this.basicDetailsContext);
        },

        onAddItem: function () {
            const itemsTable = this.byId("idRFQItemsTable");
            const model = this.getView().getModel();

            // Determine the next item number
            const nextItemNumber = itemsTable.getItems().length + 1;

            // Create OData entry for the new item
            const itemContext = model.createEntry("/ZC_RFQItemDetails", {
                properties: {
                    ItemNo: nextItemNumber,
                    Matnr: null,
                    Description: "",
                    LotType: "",
                    Werks: null, // Plant Code
                    Name1: "", // Plant Description
                    quantity: 1,
                    UnitOfMeasure: "",
                    DeliveryDate: null
                }
            });

            // Create the table row
            const newRow = new sap.m.ColumnListItem({
                cells: [
                    new sap.m.Text({
                        text: nextItemNumber.toString()
                    }),
                    new sap.ui.comp.smartfield.SmartField({
                        value: "{Description}",
                        change: this.onMaterialDescriptionChange.bind(this),
                        mandatory: true,
                        textInEditModeSource: "ValueList",
                    }),
                    new sap.m.Input({
                        value: "{LotType}",
                        editable: false,
                        required: true
                    }),
                    new sap.ui.comp.smartfield.SmartField({
                        value: "{Werks}",
                        mandatory: true,
                        textInEditModeSource: "ValueList"
                    }),
                    new sap.m.Input({
                        value: "{quantity}",
                        type: "Number",
                        placeholder: "Enter Quantity",
                        required: true,
                        liveChange: this.onQuantityChange.bind(this)
                    }),
                    new sap.m.Input({
                        value: "{UnitOfMeasure}",
                        editable: false,
                        placeholder: "Unit Of Measure",
                        required: true
                    }),
                    new sap.m.DatePicker({
                        value: "{DeliveryDate}",
                        placeholder: "Enter Unit Of Measure",
                        required: true,
                        displayFormat: "yyyy-MM-dd",
                        valueFormat: "yyyy-MM-dd"
                    })
                ]
            });

            newRow.setBindingContext(itemContext);
            itemsTable.addItem(newRow);
        },

        onDeleteItem: function () {
            const itemsTable = this.byId("idRFQItemsTable");
            const model = this.getOwnerComponent().getModel();
            const selectedItems = itemsTable.getSelectedItems();

            if (selectedItems.length === 0) {
                sap.m.MessageToast.show("Select at least one row");
                return;
            }

            selectedItems.forEach(function (item) {
                const context = item.getBindingContext();
                model.deleteCreatedEntry(context);
                itemsTable.removeItem(item);
            });

            // Re-index the remaining items
            this.reindexItems(itemsTable);
            itemsTable.removeSelections(true);
        },

        reindexItems: function (itemsTable) {
            const remainingItems = itemsTable.getItems();

            remainingItems.forEach(function (item, index) {
                const itemNumberText = item.getCells()[0];
                itemNumberText.setText((index + 1).toString());
            });
        },

        onMaterialDescriptionChange: function (event) {
            const smartField = event.getSource();
            const path = event.getSource()._oFactory.oTextArrangementDelegate.sBindingContextPath;
            const startIndex = path.indexOf("'") + 1;
            const endIndex = path.lastIndexOf("'");
            const iMatnr = path.substring(startIndex, endIndex);
            console.log(iMatnr);
            // const oContext = event.getSource().getBindingContext().getObject();
            const materialDescription = event.getParameter("value");
            const row = smartField.getParent();
            const context = row.getBindingContext();

            if (!context || !iMatnr) return;

            // Check if the Material Description is empty
            if (!materialDescription || !iMatnr) {
                context.setProperty("LotType", "");
                context.setProperty("UnitOfMeasure", "");
                context.setProperty("Description", "");
                // context.setProperty("Matnr", "");
                return;
            }

            // Get OData model
            const model = this.getView().getModel();

            // Fetch the full material data based on the selected description
            model.read("/ZC_AISP_MATERIALDETAILS_VH", {
                filters: [new Filter("Matnr", FilterOperator.EQ, iMatnr)],
                success: function (data) {
                    if (data.results.length > 0) {
                        const selectedMaterial = data.results[0];
                        context.setProperty("Description", selectedMaterial.Maktx || "Group");
                        context.setProperty("LotType", selectedMaterial.MaterialGroup || "Group");
                        context.setProperty("UnitOfMeasure", selectedMaterial.UnitOfMeasure || "");
                        context.setProperty("Matnr", selectedMaterial.Matnr || "");
                    } else {
                        context.setProperty("LotType", "");
                        context.setProperty("unitOfMeasure", "");
                        context.setProperty("Matnr", "");
                        MessageBox.show("No matching material found.");
                    }
                },
                error: function (error) {
                    console.error("Error fetching material data:", error);
                    MessageBox.show("Error loading material details.");
                }
            });
        },

        onQuantityChange: function (event) {
            const input = event.getSource();
            const value = input.getValue();
            const numericValue = parseFloat(value);

            // Validate the quantity value
            if (isNaN(numericValue) || numericValue <= 0) {
                input.setValueState(sap.ui.core.ValueState.Error);
                input.setValueStateText("Quantity must be a number greater than 0.");
                input.setValue("");
            } else {
                input.setValueState(sap.ui.core.ValueState.None);
                input.setValueStateText("");
            }
        },

        onAddSupplier: function () {
            const suppliersTable = this.byId("suppliersTable");
            const model = this.getView().getModel();

            // Create an OData entry for the new supplier
            const supplierContext = model.createEntry("/ZC_RFQSupplierDetails", {
                properties: {
                    Lifnr: null,          // Supplier code
                    VendorName: ""        // Supplier name
                }
            });

            // Create the table row
            const newRow = new sap.m.ColumnListItem({
                cells: [
                    new sap.ui.comp.smartfield.SmartField({
                        value: "{Lifnr}",
                        textInEditModeSource: "ValueList",
                        change: this.onSupplierChange.bind(this),
                        editable: true
                    }),
                    new sap.m.Input({
                        value: "{VendorName}",
                        editable: false
                    })
                ]
            });

            newRow.setBindingContext(supplierContext);
            suppliersTable.addItem(newRow);
        },

        onDeleteSupplier: function () {
            const suppliersTable = this.byId("suppliersTable");
            const model = this.getOwnerComponent().getModel();
            const selectedItems = suppliersTable.getSelectedItems();

            if (selectedItems.length === 0) {
                sap.m.MessageToast.show("Select at least one row");
                return;
            }

            selectedItems.forEach(function (item) {
                const context = item.getBindingContext();
                model.deleteCreatedEntry(context);
                suppliersTable.removeItem(item);
            });

            suppliersTable.removeSelections(true);
        },

        onSupplierChange: function (event) {
            const smartField = event.getSource();
            const context = smartField.getParent().getBindingContext();

            if (!context) return;

            const model = context.getModel();
            const path = context.getPath();
            const supplierCode = event.getParameter("newValue") || event.getParameter("value") || model.getProperty(path + "/Lifnr");

            if (!supplierCode) {
                model.setProperty(path + "/VendorName", "");
                return;
            }

            // Fetch supplier details
            model.read("/ZC_AISP_VENDORDETAILS_VH", {
                filters: [new Filter("Lifnr", FilterOperator.EQ, supplierCode)],
                urlParameters: { $select: "Lifnr,VendorName" },
                success: function (data) {
                    const supplier = (data.results && data.results[0]) || {};
                    model.setProperty(path + "/Lifnr", supplier.Lifnr || supplierCode);
                    model.setProperty(path + "/VendorName", supplier.VendorName || "");
                },
                error: function (error) {
                    console.error("Error fetching supplier data:", error);
                    MessageBox.show("Error loading supplier details.");
                }
            });
        },

        onSubmitRFQ: function () {
            const model = this.getView().getModel();
            const basicDetailsContext = this.basicDetailsContext;

            if (!basicDetailsContext) {
                MessageBox.error("Header not initialized.");
                return;
            }

            const headerPath = basicDetailsContext.getPath();
            const headerData = model.getObject(headerPath) || {};
            const validationErrors = this.validateRFQData(headerData);

            if (validationErrors.length > 0) {
                MessageBox.error("Please fix the following errors:\n\n• " + validationErrors.join("\n• "));
                return;
            }

            // Build the complete payload
            const payload = this.buildRFQPayload(headerData);

            // Submit the RFQ
            this.submitRFQToBackend(payload);
        },

        validateRFQData: function (headerData) {
            const errors = [];

            // Header validation
            if (!headerData.projectName) errors.push("Project Name is required.");
            if (!headerData.reference) errors.push("Reference is required.");
            if (!headerData.quotationDeadline) errors.push("Quotation Deadline is required.");
            if (!headerData.Waers) errors.push("Currency is required.");
            if (!headerData.Zterm) errors.push("Payment Terms is required.");
            if (!headerData.CompanyCode) errors.push("Company Code is required.");
            if (!headerData.Ekorg) errors.push("Purchase Org is required.");
            if (!headerData.Ekgrp) errors.push("Purchase Group is required.");

            // Items validation
            const items = this.byId("idRFQItemsTable").getItems();
            if (items.length === 0) {
                errors.push("At least one Item is required.");
            } else {
                items.forEach(function (item, index) {
                    const context = item.getBindingContext();
                    const itemData = context ? context.getModel().getObject(context.getPath()) : null;
                    if (!itemData) return;

                    if (!itemData.Matnr) errors.push(`Row ${index + 1}: Material is required.`);
                    if (!itemData.quantity || Number(itemData.quantity) <= 0) errors.push(`Row ${index + 1}: Quantity must be > 0.`);
                    if (!itemData.UnitOfMeasure) errors.push(`Row ${index + 1}: UoM is required.`);
                    if (!itemData.DeliveryDate) errors.push(`Row ${index + 1}: Delivery Date is required.`);
                });
            }

            // Suppliers validation
            const suppliers = this.byId("suppliersTable").getItems();
            if (suppliers.length === 0) {
                errors.push("At least one Supplier is required.");
            } else {
                suppliers.forEach(function (supplier, index) {
                    const context = supplier.getBindingContext();
                    const supplierData = context ? context.getModel().getObject(context.getPath()) : null;
                    if (!supplierData) return;

                    if (!supplierData.Lifnr) errors.push(`Supplier row ${index + 1}: Supplier Code is required.`);
                });
            }

            return errors;
        },

        buildRFQPayload: function (headerData) {
            // Build items payload
            const itemsPayload = this.byId("idRFQItemsTable").getItems().map(function (item, index) {
                const context = item.getBindingContext();
                const itemData = context ? context.getModel().getObject(context.getPath()) : null;
                if (!itemData) return null;

                const itemNumber = itemData.ItemNo || (index + 1);

                return {
                    ItemNo: itemNumber.toString(),
                    MaterialNo: itemData.Matnr || null,
                    MaterialDesc: itemData.Description || "",
                    LotType: itemData.LotType || "",
                    PlantCode: itemData.Werks || null,
                    // Name1: itemData.Name1 || "",
                    Quantity: (itemData.quantity).toString(),
                    UnitOfMeasure: itemData.UnitOfMeasure || "",
                    DeliveryDate: itemData.DeliveryDate || null
                };
            }).filter(function (item) { return item !== null; });

            // Build suppliers payload
            const suppliersPayload = this.byId("suppliersTable").getItems().map(function (supplier) {
                const context = supplier.getBindingContext();
                const supplierData = context ? context.getModel().getObject(context.getPath()) : null;
                if (!supplierData) return null;

                return {
                    SupplierCode: supplierData.Lifnr || null,
                    SupplierName: supplierData.VendorName || ""
                };
            }).filter(function (supplier) { return supplier !== null; });

            // Build complete payload
            return {
                RFQProjectName: headerData.projectName,
                ReferenceInput: headerData.reference,
                QuotationDeadline: headerData.quotationDeadline,
                CurrencyCode: headerData.Waers,
                PaymentTermCode: headerData.Zterm,
                IncoTermCode: headerData.Inco1,
                CompanyCode: headerData.CompanyCode,
                PurchaseOrgCode: headerData.Ekorg,
                PurchaseGroupCode: headerData.Ekgrp,
                Description: "Description",
                RFQType: "Material",
                RFQToItem: itemsPayload,
                RFQToSupplier: suppliersPayload
            };
        },

        submitRFQToBackend: function (payload) {
            const model = this.getView().getModel();

            try {
                this._setBusy(true);

                model.create("/createRFQ", payload, {
                    success: function (data) {
                        let rfqNumber = data?.createRFQ?.rfqnumber;
                        this._setBusy(false);
                        MessageBox.success(`RFQ with number ${rfqNumber} created successfully.`);
                        this.resetAfterSubmit();
                    }.bind(this),
                    error: function (error) {
                        this._setBusy(false);
                        let errorMessage = "Submission failed.";

                        const errorResponse = error.responseText && JSON.parse(error.responseText);
                        errorMessage = errorResponse.error.message.value || errorResponse.error.message || errorMessage;
                        MessageBox.error(errorMessage);
                    }.bind(this),
                });
            } catch (e) {
                MessageBox.error(e.errorMessage);
            }
        },

        resetAfterSubmit: function () {
            const model = this.getView().getModel();

            // Remove all items
            const itemsTable = this.byId("idRFQItemsTable");

            itemsTable.getItems().forEach(function (item) {
                const context = item.getBindingContext();
                if (context && context.getPath().includes("$uid")) {
                    try { model.deleteCreatedEntry(context); } catch (e) { }
                }
                itemsTable.removeItem(item);
            });

            // Remove all suppliers
            const suppliersTable = this.byId("suppliersTable");

            suppliersTable.getItems().forEach(function (supplier) {
                const context = supplier.getBindingContext();
                if (context && context.getPath().includes("$uid")) {
                    try { model.deleteCreatedEntry(context); } catch (e) { }
                }
                suppliersTable.removeItem(supplier);
            });

            // Reset basic details context
            if (this.basicDetailsContext) {
                try { model.deleteCreatedEntry(this.basicDetailsContext); } catch (e) { }
                this.basicDetailsContext = null;
            }

            // Recreate basic details context
            this.basicDetailsContext = model.createEntry("/ZC_RFQBasicDetails", {
                properties: {
                    RFQProjectName: "",
                    Reference: "",
                    QuotationDeadline: null,
                    Waers: null,
                    Zterm: null,
                    Inco1: null,
                    CompanyCode: null,
                    Ekorg: null,
                    Ekgrp: null
                }
            });

            this.byId("idRFQBasicDetails").setBindingContext(this.basicDetailsContext);

            this._navigateToList();
        },

        _navigateToList: function () {
            this.getOwnerComponent().getRouter().navTo("RouteRFQPriceList");
        },

        _setBusy: function (bBusy) {
            this.getView().setBusy(bBusy);
        },
    });
});