sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/Text",
    "sap/m/Column",
    "sap/m/ObjectNumber",
    "sap/ui/core/Fragment",
    "sap/ui/core/ws/WebSocket",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox,
    Text,
    Column,
    ObjectNumber,
    Fragment,
    WebSocket
  ) {
    "use strict";

    return Controller.extend("com.pricecomp.pricecomp.controller.CompareRFQ", {
      CONFIG: {
        COUNTDOWN_INTERVAL: 1000, // 1 second
      },

      onInit: function () {
        this.oRouter = this.getOwnerComponent().getRouter();
        this.oRouter
          .getRoute("RouteCompareRFQ")
          .attachPatternMatched(this._onRouteMatched, this);

        // Initialize models
        this._initializeModels();
      },

      _initializeModels: function () {
        this._setModel("oHeaderModel", { results: [] });
        this._setModel("oItemsModel", { results: [] });
        this._setModel("oChartModel", { chartData: [], supplierDetails: [] });
        this._setModel("oCountdownModel", {
          days: "--",
          hours: "--",
          mins: "--",
          secs: "--",
        });
        this._setModel("oProcessFlowModel", { nodes: [], lanes: [] }); // Model for process flow
        this._setModel("oTableDataModel", { quotations: [], materials: [] });
      },

      onSelectChangeRFQ: function (oEvent) {
        var count = this.byId("innerTable").getSelectedItems().length;
        var btnCompare = this.byId("idCompare");
        btnCompare.setEnabled(count > 1);
      },

      onPressCompare: function (oEvent) {
        var oTable = this.byId("innerTable");
        var selectedItems = oTable.getSelectedItems();

        if (selectedItems.length < 2) {
          MessageBox.warning("Please select at least two items to compare.");
          return;
        }

        var selectedBidders = [];
        var oTableModel = this.getView().getModel(); // or specify the correct model name

        selectedItems.forEach(function (oItem) {
          var oContext = oItem.getBindingContext();
          if (oContext) {
            var oBidderID = oContext.getProperty("Bidder");
            selectedBidders.push(oBidderID);
          }
        });

        if (selectedBidders.length < 2) {
          MessageBox.error(
            "Error retrieving selected items. Please try again."
          );
          return;
        }

        // Fix: Pass parameters correctly to router
        this.getOwnerComponent()
          .getRouter()
          .navTo("RouteCompareQuotation", {
            rfqnumber: this.rfqNumber,
            bidders: selectedBidders.join(","), // Join array as comma-separated string
          });
      },

      /* === DATA LOADING === */
      _loadData: async function (rfqNum) {
        const oHeaderModel = this.getView().getModel("oHeaderModel");
        const oItemsModel = this.getView().getModel("oItemsModel");

        let aFilters = [new Filter("RfqNumber", FilterOperator.EQ, rfqNum)];

        await Promise.all([
          this._loadEntity("/RFQHeaders", aFilters, "oHeaderModel"),
          this._loadEntity("/RFQItems", aFilters, "oItemsModel"),
        ]);

        // Load chart data separately to transform it
        await this._loadChartData(aFilters);
        await this._loadTable(aFilters);
        await this._loadProcessFlowData(rfqNum);

        const oHeaderData = oHeaderModel.getProperty("/results")[0];
        const oItemsData = oItemsModel.getProperty("/results");

        if (oHeaderData) {
          this._startCountdown(oHeaderData.EventEndDate);
        }

        // if (oItemsData && oItemsData.length > 0) {
        //     this._transformAndLoadTableData();
        // }
      },

      _loadEntity: function (sPath, aFilters, sModelName) {
        const oODataModel = this.getOwnerComponent().getModel();

        return new Promise((resolve, reject) => {
          oODataModel.read(sPath, {
            filters: aFilters,
            success: (oData) => {
              this.getView()
                .getModel(sModelName)
                .setProperty("/results", oData.results || []);
              resolve();
            },
            error: reject,
          });
        });
      },

      _loadTable: function (aFilters) {
        const oODataModel = this.getOwnerComponent().getModel();

        return new Promise((resolve, reject) => {
          oODataModel.read("/RFQSuppliers", {
            filters: aFilters,
            success: (oData) => {
              this.getView()
                .getModel("oTableDataModel")
                .setProperty("/quotations", oData.results || []);
              debugger;
              resolve();
            },
            error: reject,
          });
        });
      },

      _setModel: function (sName, oData) {
        this.getView().setModel(new JSONModel(oData), sName);
      },

      _onRouteMatched: async function (oEvent) {
        this._setBusy(true);
        const { rfqNum } = oEvent.getParameter("arguments");
        if (!rfqNum) {
          this._showError("RFQ Number is not present!!");
          this._navigateToList();
          return;
        }
        this.rfqNumber = rfqNum;
        this.getMaterialsName(rfqNum);
        try {
          this._initializeModels();
          await this._loadData(rfqNum);
          await this.onUpdateNegotiationData();
          this.initialiseSocket();
          this.byId("quotationTable").rebindTable();
        } catch (oError) {
          this._showError(`Failed to load data: ${oError.message}`);
        } finally {
          this._setBusy(false);
        }
      },

      onBeforeRebindTable: function (oEvent) {
        const oBindingParams = oEvent.getParameter("bindingParams");

        // Debug: Log to check if function is called
        console.log("onBeforeRebindTable called", oBindingParams);

        if (oBindingParams && oBindingParams.filters) {
          // Fix: Use a different variable name to avoid shadowing
          const oRfqFilter = new Filter(
            "RfqNumber",
            FilterOperator.EQ,
            this.rfqNumber
          );
          oBindingParams.filters.push(oRfqFilter);

          console.log("Filter added:", oRfqFilter); // Debug
        } else {
          console.error(
            "BindingParams or filters not available:",
            oBindingParams
          ); // Debug
        }
      },

      /* === CHART DATA === */
      _loadChartData: function (aFilters) {
        const oODataModel = this.getOwnerComponent().getModel();
        const oChartModel = this.getView().getModel("oChartModel");

        return new Promise((resolve, reject) => {
          oODataModel.read("/SupplierStatusDistribution", {
            filters: aFilters,
            success: (oData) => {
              if (oData.results && oData.results[0]) {
                const oStatusData = oData.results[0];

                // Transform data for chart visualization
                const aChartData =
                  this._transformStatusDataForChart(oStatusData);

                // Update both chartData and supplierDetails
                oChartModel.setProperty("/chartData", aChartData);
                oChartModel.setProperty(
                  "/supplierDetails",
                  oStatusData.SupplierDetails || []
                );
              } else {
                // Set empty arrays if no data
                oChartModel.setProperty("/chartData", []);
                oChartModel.setProperty("/supplierDetails", []);
              }
              resolve();
            },
            error: (oError) => {
              console.error("Error loading chart data:", oError);
              reject(oError);
            },
          });
        });
      },

      _transformStatusDataForChart: function (oStatusData) {
        // Transform the status counts into chart-friendly format
        return [
          {
            type: "Submitted",
            count: oStatusData.SubmittedCount || 0,
            color: "#4CAF50", // Green for submitted
          },
          {
            type: "Accepted",
            count: oStatusData.AcceptedCount || 0,
            color: "#2196F3", // Blue for accepted
          },
          {
            type: "Not Accepted",
            count: oStatusData.NotAcceptedCount || 0,
            color: "#FF9800", // Orange for not accepted
          },
          {
            type: "Rejected",
            count: oStatusData.RejectedCount || 0,
            color: "#F44336", // Red for rejected
          },
          {
            type: "Pending",
            count: this._calculatePendingCount(oStatusData),
            color: "#9E9E9E", // Grey for pending
          },
        ];
      },

      _calculatePendingCount: function (oStatusData) {
        // Calculate pending count based on total suppliers minus other statuses
        const totalSuppliers = oStatusData.SupplierDetails
          ? oStatusData.SupplierDetails.length
          : 0;
        const accountedSuppliers =
          (oStatusData.SubmittedCount || 0) +
          (oStatusData.AcceptedCount || 0) +
          (oStatusData.NotAcceptedCount || 0) +
          (oStatusData.RejectedCount || 0);

        return Math.max(0, totalSuppliers - accountedSuppliers);
      },

      /* === TABLE DATA === */
      _transformAndLoadTableData: function () {
        const oItemsModel = this.getView().getModel("oItemsModel");
        const oTableDataModel = this.getView().getModel("oTableDataModel");
        const aItems =
          oItemsModel.getProperty("/results") ||
          oItemsModel.getProperty("/value");

        if (!aItems || aItems.length === 0) {
          oTableDataModel.setProperty("/quotations", []);
          return;
        }

        // 1) Unique materials (for dynamic columns)
        const aMaterials = aItems.reduce((acc, item) => {
          if (!acc.find((m) => m.MaterialDesc === item.MaterialDesc)) {
            acc.push({
              MaterialDesc: item.MaterialDesc,
              MaterialNo: item.MaterialNo,
            });
          }
          return acc;
        }, []);

        // 2) Group by bidder; collect prices AND scores
        const oGrouped = aItems.reduce((acc, item) => {
          const {
            Bidder,
            SupplierQuotation,
            QuotationValue,
            MaterialDesc,
            Netpr,
            Currency,
            TOTAL_SCORE,
          } = item;

          if (!acc[Bidder]) {
            acc[Bidder] = {
              quotationNo: SupplierQuotation,
              supplier: Bidder, // or "Supplier " + Bidder
              quotationValue: Number(QuotationValue) || 0,
              currency: Currency || "INR",
              materialPrices: {},
              materialScores: {},
              _scoreSum: 0,
              _scoreCnt: 0,
            };
          }

          const sSafeKey = (MaterialDesc || "").replace(/[^a-zA-Z0-9]+/g, "_");
          acc[Bidder].materialPrices[sSafeKey] = Netpr;
          acc[Bidder].materialScores[sSafeKey] = TOTAL_SCORE;

          const sc = Number(TOTAL_SCORE);
          if (!Number.isNaN(sc)) {
            acc[Bidder]._scoreSum += sc;
            acc[Bidder]._scoreCnt += 1;
          }
          return acc;
        }, {});

        // 3) Finalize rows; compute aggregate TOTAL_SCORE as average across items
        const aQuotations = Object.values(oGrouped).map((q) => {
          const avg = q._scoreCnt ? q._scoreSum / q._scoreCnt : 0;
          q.TOTAL_SCORE = avg; // keep the name you sort on
          delete q._scoreSum;
          delete q._scoreCnt;
          return q;
        });

        oTableDataModel.setProperty("/quotations", aQuotations);
        oTableDataModel.setProperty("/totalCount", aQuotations.length);

        const minPrice = aQuotations.reduce(
          (min, q) => Math.min(min, Number(q.quotationValue) || Infinity),
          Infinity
        );
        const maxScore = aQuotations.reduce(
          (max, q) => Math.max(max, Number(q.TOTAL_SCORE) || 0),
          0
        );
        oTableDataModel.setProperty("/minQuotationValue", minPrice);
        oTableDataModel.setProperty("/maxTotalScore", maxScore);

        // remember materials + default mode
        this._aMaterials = aMaterials;
        this._rankingMode = this._rankingMode || "price";

        // 4) Build table for current mode
        this._buildTableStructure(this._aMaterials, this._rankingMode);
      },

      _buildTableStructure: function (
        aMaterials,
        sMode /* "price" | "score" */
      ) {
        const oTable = this.byId("quotationTable");
        const oModel = this.getView().getModel("oTableDataModel");

        oTable.destroyColumns();
        oTable.destroyItems();

        // Row highlight: min price OR max score
        const oTemplate = new sap.m.ColumnListItem({
          highlight: {
            parts: [
              { path: "oTableDataModel>quotationValue" },
              { path: "oTableDataModel>TOTAL_SCORE" },
            ],
            formatter: (price, score) => {
              if (sMode === "score") {
                const max = Number(oModel.getProperty("/maxTotalScore")) || 0;
                return Number(score) === max
                  ? sap.ui.core.ValueState.Success
                  : sap.ui.core.ValueState.None;
              } else {
                const min =
                  Number(oModel.getProperty("/minQuotationValue")) || Infinity;
                return Number(price) === min
                  ? sap.ui.core.ValueState.Success
                  : sap.ui.core.ValueState.None;
              }
            },
          },
        });

        // Static columns
        oTable.addColumn(
          new sap.m.Column({
            header: new sap.m.Text({ text: "Quotation No" }),
          })
        );
        oTemplate.addCell(
          new sap.m.Text({ text: "{oTableDataModel>quotationNo}" })
        );

        oTable.addColumn(
          new sap.m.Column({ header: new sap.m.Text({ text: "Supplier" }) })
        );
        oTemplate.addCell(
          new sap.m.Text({ text: "{oTableDataModel>supplier}" })
        );

        // Mode-specific static column
        if (sMode === "price") {
          oTable.addColumn(
            new sap.m.Column({
              header: new sap.m.Text({ text: "Quotation Value" }),
              hAlign: "End",
            })
          );
          oTemplate.addCell(
            new sap.m.ObjectNumber({
              number: "{oTableDataModel>quotationValue}",
              unit: "{oTableDataModel>currency}",
            })
          );
        } else {
          // score
          oTable.addColumn(
            new sap.m.Column({
              header: new sap.m.Text({ text: "Total Score" }),
              hAlign: "End",
            })
          );
          oTemplate.addCell(
            new sap.m.ObjectNumber({
              number: {
                path: "oTableDataModel>TOTAL_SCORE",
                formatter: (v) => (v == null ? "-" : v),
              },
              unit: "pts",
            })
          );
        }

        // Dynamic material columns
        aMaterials.forEach((material) => {
          const full = material.MaterialDesc || "";
          const short = full.length > 15 ? full.substring(0, 15) + "..." : full;
          const key = full.replace(/[^a-zA-Z0-9]+/g, "_");

          oTable.addColumn(
            new sap.m.Column({
              width: "12%",
              hAlign: "End",
              header: new sap.m.Text({
                text: `${short} (${sMode === "score" ? "Score" : "Price"})`,
                tooltip: full,
              }),
            })
          );

          if (sMode === "score") {
            // show per-material score
            oTemplate.addCell(
              new sap.m.ObjectNumber({
                number: {
                  path: "oTableDataModel>materialScores/" + key,
                  formatter: (v) => (v == null ? "-" : v),
                },
                unit: "pts",
              })
            );
          } else {
            // show per-material price
            oTemplate.addCell(
              new sap.m.ObjectNumber({
                number: {
                  path: "oTableDataModel>materialPrices/" + key,
                  formatter: (v) => (v == null ? "-" : v),
                },
                unit: "{oTableDataModel>currency}",
              })
            );
          }
        });

        // Bind rows
        oTable.bindAggregation("items", {
          path: "oTableDataModel>/quotations",
          template: oTemplate,
        });
      },

      onRankingChange: function (oEvent) {
        const key = oEvent.getSource().getSelectedKey(); // "price" | "score"
        const table = this.byId("quotationTable");
        this._rankingMode = key === "score" ? "score" : "price";

        // Rebuild columns/cells for the mode
        this._buildTableStructure(this._aMaterials, this._rankingMode);

        // Apply sort for the mode
        const sortPath =
          this._rankingMode === "score" ? "TOTAL_SCORE" : "quotationValue";
        const desc = this._rankingMode === "score"; // score: highest first
        const binding = table.getBinding("items");
        if (binding) {
          binding.sort(new sap.ui.model.Sorter(sortPath, desc));
        }
      },

      /* === PROCESS FLOW DATA === */
      _loadProcessFlowData: function (rfqNum) {
        const oODataModel = this.getOwnerComponent().getModel();
        const oProcessFlowModel = this.getView().getModel("oProcessFlowModel");

        let aFilters = [new Filter("RFQNumber", FilterOperator.EQ, rfqNum)];

        const that = this;

        return new Promise((resolve, reject) => {
          oODataModel.read("/RFQProcessFlows", {
            // filters: aFilters,
            success: (oData) => {
              if (oData.results && oData.results[0]) {
                const oProcessFlowData = oData.results[0];
                that._setupProcessFlowData(oProcessFlowData);
              } else {
                oProcessFlowModel.setProperty("/nodes", []);
                oProcessFlowModel.setProperty("/lanes", []);
              }
              resolve();
            },
            error: (oError) => {
              console.error("Error loading chart data:", oError);
              reject(oError);
            },
          });
        });
      },

      // _setupProcessFlowData: function (oProcessFlowData) {
      //     var oProcessFlowModel = this.getView().getModel("oProcessFlowModel");

      //     // Dummy data that represents the structure you expect from the backend.
      //     // Replace this with your actual data source.
      //     // var aDummyData = [
      //     //     {
      //     //         "questionNo": "600001",
      //     //         "createdAt": "2024-05-15",
      //     //         "deadlineDate": "2024-06-30",
      //     //         "suppliers": [
      //     //             {
      //     //                 "SupplierName": "Supplier-A",
      //     //                 "SupplierCode": "SQ1",
      //     //                 "Status": "Accepted",
      //     //                 "SupplierQuotation": "1",
      //     //                 "QuotationCreationDate": "2024-05-20"
      //     //             },
      //     //             {
      //     //                 "SupplierName": "Supplier-B",
      //     //                 "SupplierCode": "SQ2",
      //     //                 "Status": "Accepted",
      //     //                 "SupplierQuotation": "2",
      //     //                 "QuotationCreationDate": "2024-05-22"
      //     //             },
      //     //             {
      //     //                 "SupplierName": "Supplier-C",
      //     //                 "SupplierCode": "SQ3",
      //     //                 "Status": "Awarded",
      //     //                 "SupplierQuotation": "3",
      //     //                 "QuotationCreationDate": "2024-05-25"
      //     //             }
      //     //         ],
      //     //         "isAwarded": true,
      //     //         "awardedDate": "2024-06-05",
      //     //         "purchaseOrderCreated": true,
      //     //         "purchaseOrderNumber": 1001
      //     //     }
      //     // ];

      //     var aNodes = [];
      //     var aLanes = [
      //         { "id": "lane1", "icon": "sap-icon://question-mark", "label": "Question", "position": 0 },
      //         { "id": "lane2", "icon": "sap-icon://supplier", "label": "Suppliers", "position": 1 },
      //         { "id": "lane3", "icon": "sap-icon://competitor", "label": "Awarded", "position": 2 },
      //         { "id": "lane4", "icon": "sap-icon://cart", "label": "Purchase Order", "position": 3 }
      //     ];

      //     oProcessFlowData.forEach(function (oData) {
      //         // Lane 1: Question Node
      //         var aSupplierNodeIds = oData.suppliers.map(s => s.SupplierQuotation);
      //         aNodes.push({
      //             "id": oData.questionNo,
      //             "lane": "lane1",
      //             "title": "Question No. " + oData.questionNo,
      //             "titleAbbreviation": oData.questionNo,
      //             "children": aSupplierNodeIds,
      //             "isTitleClickable": false,
      //             "state": "Positive",
      //             "stateText": "Question Created",
      //             "texts": [
      //                 "Created: " + oData.createdAt,
      //                 "Deadline: " + oData.deadlineDate
      //             ]
      //         });

      //         var sAwardedQuotationId;

      //         // Lane 2: Supplier Nodes
      //         oData.suppliers.forEach(function (oSupplier) {
      //             var aChildren = [];
      //             var sState = "Neutral";
      //             var sStateText = "Pending";

      //             if (oSupplier.Status === "Awarded") {
      //                 sAwardedQuotationId = "awarded-" + oSupplier.SupplierQuotation;
      //                 aChildren.push(sAwardedQuotationId);
      //                 sState = "Positive";
      //                 sStateText = "Awarded";
      //             } else if (oSupplier.Status === "Accepted") {
      //                 sState = "Positive";
      //                 sStateText = "Accepted";
      //             }

      //             aNodes.push({
      //                 "id": oSupplier.SupplierQuotation,
      //                 "lane": "lane2",
      //                 "title": oSupplier.SupplierName,
      //                 "titleAbbreviation": oSupplier.SupplierCode,
      //                 "children": aChildren,
      //                 "isTitleClickable": false,
      //                 "state": sState,
      //                 "stateText": sStateText,
      //                 "texts": [
      //                     "Quotation No. " + oSupplier.SupplierQuotation,
      //                     "Created: " + oSupplier.QuotationCreationDate
      //                 ]
      //             });
      //         });

      //         // Lane 3: Awarded Quotation Node
      //         if (sAwardedQuotationId) {
      //             var aChildren = [];
      //             if (oData.purchaseOrderCreated) {
      //                 aChildren.push("po-" + oData.purchaseOrderNumber);
      //             }
      //             aNodes.push({
      //                 "id": sAwardedQuotationId,
      //                 "lane": "lane3",
      //                 "title": "Awarded Quotation " + sAwardedQuotationId.split("-")[1],
      //                 "titleAbbreviation": sAwardedQuotationId.split("-")[1],
      //                 "children": aChildren,
      //                 "isTitleClickable": false,
      //                 "state": "Positive",
      //                 "stateText": "Awarded",
      //                 "texts": [
      //                     "Awarded Date: " + oData.awardedDate
      //                 ]
      //             });
      //         }

      //         // Lane 4: Purchase Order Node
      //         if (oData.purchaseOrderCreated) {
      //             aNodes.push({
      //                 "id": "po-" + oData.purchaseOrderNumber,
      //                 "lane": "lane4",
      //                 "title": "Purchase Order " + oData.purchaseOrderNumber,
      //                 "titleAbbreviation": "PO " + oData.purchaseOrderNumber,
      //                 "children": null,
      //                 "isTitleClickable": false,
      //                 "state": "Positive",
      //                 "stateText": "Created",
      //                 "texts": []
      //             });
      //         }
      //     });

      //     var oProcessFlowData = {
      //         "nodes": aNodes,
      //         "lanes": aLanes
      //     };

      //     oProcessFlowModel.setData(oProcessFlowData);
      //     this.getView().byId("processflow1").setZoomLevel("Two")
      // },

      _setupProcessFlowData: function (oProcessFlowData) {
        var oProcessFlowModel = this.getView().getModel("oProcessFlowModel");

        var aNodes = [];
        var aLanes = [
          {
            id: "lane1",
            icon: "sap-icon://question-mark",
            label: "Quotation",
            position: 0,
          },
          {
            id: "lane2",
            icon: "sap-icon://supplier",
            label: "Suppliers",
            position: 1,
          },
          {
            id: "lane3",
            icon: "sap-icon://competitor",
            label: "Awarded",
            position: 2,
          },
          {
            id: "lane4",
            icon: "sap-icon://cart",
            label: "Purchase Order",
            position: 3,
          },
        ];

        // Convert single object to array if needed
        var aProcessFlowData = Array.isArray(oProcessFlowData)
          ? oProcessFlowData
          : [oProcessFlowData];

        aProcessFlowData.forEach(function (oData) {
          // Lane 1: Question Node
          var aSupplierNodeIds = [];
          if (oData.Suppliers && Array.isArray(oData.Suppliers)) {
            aSupplierNodeIds = oData.Suppliers.map(function (s) {
              return s.SupplierQuotation || s.SupplierCode; // Use SupplierCode if SupplierQuotation is null
            }).filter(function (id) {
              return id !== null;
            }); // Filter out null values
          }

          aNodes.push({
            id: oData.RFQNumber || oData.WorkFlowID,
            lane: "lane1",
            title: "RFQ No. " + (oData.RFQNumber || oData.WorkFlowID),
            titleAbbreviation: oData.RFQNumber || oData.WorkFlowID,
            children: aSupplierNodeIds,
            isTitleClickable: false,
            state: "Positive",
            stateText: "RFQ Created",
            texts: [
              "Created: " +
                (oData.CreatedAt
                  ? new Date(oData.CreatedAt).toLocaleDateString()
                  : "N/A"),
              "Deadline: " +
                (oData.QuotationDeadline
                  ? new Date(oData.QuotationDeadline).toLocaleDateString()
                  : "N/A"),
            ],
          });

          var sAwardedQuotationId;

          // Lane 2: Supplier Nodes
          if (oData.Suppliers && Array.isArray(oData.Suppliers)) {
            oData.Suppliers.forEach(function (oSupplier) {
              var aChildren = [];
              var sState = "Neutral";
              var sStateText = "Pending";
              var sNodeId =
                oSupplier.SupplierQuotation || oSupplier.SupplierCode;

              if (oSupplier.Status === "Awarded") {
                sAwardedQuotationId = "awarded-" + sNodeId;
                aChildren.push(sAwardedQuotationId);
                sState = "Positive";
                sStateText = "Awarded";
              } else if (oSupplier.Status === "Accepted") {
                sState = "Positive";
                sStateText = "Accepted";
              }

              aNodes.push({
                id: sNodeId,
                lane: "lane2",
                title: oSupplier.SupplierName,
                titleAbbreviation: oSupplier.SupplierCode,
                children: aChildren,
                isTitleClickable: false,
                state: sState,
                stateText: sStateText,
                texts: [
                  "Supplier Code: " + oSupplier.SupplierCode,
                  oSupplier.SupplierQuotation
                    ? "Quotation No. " + oSupplier.SupplierQuotation
                    : "No quotation yet",
                  oSupplier.QuotationCreationDate
                    ? "Created: " +
                      new Date(
                        oSupplier.QuotationCreationDate
                      ).toLocaleDateString()
                    : "",
                ].filter(function (text) {
                  return text !== "";
                }), // Remove empty strings
              });
            });
          }

          // Lane 3: Awarded Quotation Node
          if (sAwardedQuotationId) {
            var aChildren = [];
            if (oData.purchaseOrderCreated && oData.purchaseOrderNumber) {
              aChildren.push("po-" + oData.purchaseOrderNumber);
            }
            aNodes.push({
              id: sAwardedQuotationId,
              lane: "lane3",
              title: "Awarded Quotation " + sAwardedQuotationId.split("-")[1],
              titleAbbreviation: sAwardedQuotationId.split("-")[1],
              children: aChildren,
              isTitleClickable: false,
              state: "Positive",
              stateText: "Awarded",
              texts: [
                oData.AwardedDate
                  ? "Awarded Date: " +
                    new Date(oData.AwardedDate).toLocaleDateString()
                  : "",
              ].filter(function (text) {
                return text !== "";
              }),
            });
          }

          // Lane 4: Purchase Order Node
          if (oData.purchaseOrderCreated && oData.purchaseOrderNumber) {
            aNodes.push({
              id: "po-" + oData.purchaseOrderNumber,
              lane: "lane4",
              title: "Purchase Order " + oData.purchaseOrderNumber,
              titleAbbreviation: "PO " + oData.purchaseOrderNumber,
              children: null,
              isTitleClickable: false,
              state: "Positive",
              stateText: "Created",
              texts: [],
            });
          }
        });

        var oProcessFlowModelData = {
          nodes: aNodes,
          lanes: aLanes,
        };

        oProcessFlowModel.setData(oProcessFlowModelData);
        this.getView().byId("processflow1").setZoomLevel("Two");
      },

      /* === COUNTDOWN TIMER === */
      _startCountdown: function (sDeadline) {
        if (!sDeadline) return;
        const oDeadline = new Date(sDeadline);

        if (isNaN(oDeadline)) {
          this._showError("Invalid deadline date for countdown");
          return;
        }

        if (this._countdownInterval) clearInterval(this._countdownInterval);
        this._updateCountdown(oDeadline);
        this._countdownInterval = setInterval(
          () => this._updateCountdown(oDeadline),
          this.CONFIG.COUNTDOWN_INTERVAL
        );
      },

      _updateCountdown: function (oDeadline) {
        const diff = Math.max(0, (oDeadline - new Date()) / 1000);
        if (diff === 0) clearInterval(this._countdownInterval);

        const secsTotal = Math.floor(diff);
        this.getView()
          .getModel("oCountdownModel")
          .setData({
            days: String(Math.floor(secsTotal / 86400)).padStart(2, "0"),
            hours: String(Math.floor((secsTotal % 86400) / 3600)).padStart(
              2,
              "0"
            ),
            mins: String(Math.floor((secsTotal % 3600) / 60)).padStart(2, "0"),
            secs: String(secsTotal % 60).padStart(2, "0"),
          });
      },

      onRFQAward: function () {
        var sSelectedSupplier = this.byId("innerTable").getSelectedItems();
        if (sSelectedSupplier.length === 0) {
          MessageBox.warning("Please select at least one supplier to award.");
          return;
        } else if (sSelectedSupplier.length > 1) {
          MessageBox.warning("Only one supplier can be awarded.");
          return;
        } else {
          if (!this._pApproveCommentDialog) {
            this._pApproveCommentDialog = Fragment.load({
              id: this.getView().getId(),
              name: "com.pricecomp.pricecomp.fragments.ApproveComment",
              controller: this,
            }).then(
              function (oDialog) {
                this.getView().addDependent(oDialog);
                return oDialog;
              }.bind(this)
            );
          }

          this._pApproveCommentDialog.then(
            function (oDialog) {
              this.byId("approveCommentTextArea").setValue("");
              this.byId("approveCharCounter").setText("0 / 500");
              oDialog.open();
            }.bind(this)
          );
        }
      },

      onApproveCommentLiveChange: function (oEvent) {
        const sValue = oEvent.getParameter("value") || "";
        this.byId("approveCharCounter").setText(`${sValue.length} / 500`);
      },

      onApproveCommentCancel: function () {
        this.byId("approveCommentDialog").close();
      },

      onApproveCommentSubmit: function () {
        var sComment = this.byId("approveCommentTextArea").getValue().trim();

        if (!sComment) {
          MessageBox.warning("Approval comment is required.");
          return;
        }

        this.byId("approveCommentDialog").close();
        this.awardRFQ("Award", sComment);
      },

      awardRFQ: function (sComment) {
        const model = this.getView().getModel();
        var sSelectedSupplier = this.byId("innerTable").getSelectedItems();
        var oContext = sSelectedSupplier[0].getBindingContext();
        var oObject = oContext.getObject();
        var oBidderID = oContext.getProperty("Bidder");
        const oPayload = {
          RfqNumber: oObject.RfqNumber,
          Bidder: oBidderID,
          SupplierQuotation: oObject.SupplierQuotation,
          NewStatus: "Award",
          Remarks: sComment,
        };

        try {
          this.getView().setBusy(true);

          model.create("/AwardorRejectRFQ", oPayload, {
            success: function (data) {
              this.getView().setBusy(false);
              MessageBox.success("RFQ submitted successfully.");
            }.bind(this),
            error: function (error) {
              this.getView().setBusy(false);
              let errorMessage = "Submission failed.";
              const errorResponse =
                error.responseText && JSON.parse(error.responseText);
              errorMessage =
                errorResponse.error.message.value ||
                errorResponse.error.message ||
                errorMessage;
              MessageBox.error(errorMessage);
            }.bind(this),
          });
        } catch (e) {
          this.getView().setBusy(false);
          MessageBox.error(
            e.message || "Something Went Wrong Please try again later!!!"
          );
        }
        // var selectedBidders = [];
        // selectedItems.forEach(function (oItem) {
        //     var oContext = oItem.getBindingContext("oTableDataModel");
        //     var oObject = oContext.getObject();
        //     var oBidderIDS = oContext.getProperty("Bidder");
        //     selectedBidders.push(oBidderIDS);
        // });

        // if (sSelectedSupplier) {
        // } else {
        //   MessageToast.show("Please select a supplier first");
        // }
      },

      // onAfterRendering: function () {
      //     this._customizeChart();
      // },

      // _customizeChart: function () {
      //     var oVizFrame = this.getView().byId("idVizFrame");
      //     if (oVizFrame) {
      //         oVizFrame.setVizProperties({
      //             plotArea: {
      //                 colorPalette: ["#5CB85C", "#D9534F", "#F0AD4E", "#5BC0DE"]
      //             },
      //             title: { visible: false },
      //             legend: { position: "bottom" }
      //         });
      //     }
      // },

      onNodePress: function (oEvent) {
        var oNode = oEvent.getParameter("node");
        var sNodeId = oNode.getNodeId();
        MessageToast.show("Node pressed: " + sNodeId);
      },

      /* === FORMATTERS === */

      formatDate: function (date) {
        if (!date) return "";

        var oDate = new Date(date);
        return sap.ui.core.format.DateFormat.getDateInstance({
          pattern: "yyyy-MM-dd",
        }).format(oDate);
      },

      // Add this formatter for status colors
      formatStatusState: function (sStatus) {
        switch (sStatus) {
          case "Submitted":
            return "Success";
          case "Accepted":
            return "Information";
          case "Not_Accepted":
            return "Warning";
          case "Rejected":
            return "Error";
          case "Pending":
            return "None";
          default:
            return "None";
        }
      },

      formatHeaderState: function (sStatus) {
        if (sStatus === "Open") {
          return "Indication13";
        }
        if (sStatus === "Action needed") {
          return "Indication17";
        }
        if (sStatus === "Completed") {
          return "Indication17";
        }
        return "None";
      },

      _formatPrice: function (value) {
        if (!value) return "";
        return parseFloat(value).toFixed(2);
      },

      /* === HELPER FUNCTIONS === */
      _setBusy: function (bBusy) {
        this.getView().setBusy(bBusy);
      },

      _showError: function (
        sMessage = "Something went wrong, Please Try Again After Sometime",
        oOptions = {}
      ) {
        const {
          title = "Error",
          actions = [MessageBox.Action.OK],
          onClose,
        } = oOptions;
        MessageBox.error(sMessage, { title, actions, onClose });
      },

      handleLinkPress: function () {
        this.oRouter.navTo("RouteRFQPriceList");
      },

      _navigateToList: function () {
        this.oRouter.navTo("RouteRFQPriceList");
      },

      /* === CHATBOT FUNCTIONS === */
      openNegotiationTool: function (oEvent) {
        var oButton = oEvent.getSource();
        var oView = this.getView();
        if (!this._oPopover) {
          Fragment.load({
            id: oView.getId(),
            name: "com.pricecomp.pricecomp.fragments.PriceNegotiationTool",
            controller: this,
          }).then(
            function (oPopover) {
              oView.addDependent(oPopover);
              this._oPopover = oPopover;
              this._oPopover.openBy(oButton);
            }.bind(this)
          );
        } else {
          this._oPopover.openBy(oButton);
        }
      },

      closePopover: function () {
        if (this._oPopover) {
          this._oPopover.close();
        }
      },

      initialiseSocket: async function () {
        this.socket = new WebSocket(
          "wss://chat_micro_service.cfapps.ap10.hana.ondemand.com:8080"
        );
        this.socket.attachMessage(
          async function (oEvent) {
            // This function will be called automatically when a message arrives
            var sMessage = oEvent.getParameter("data");
            console.log("Received a message: " + sMessage);
            await this.onUpdateNegotiationData();
          }.bind(this)
        );
      },

      getMaterialsName: function (rfq) {
        let oModel = this.getOwnerComponent().getModel();
        let oJSONModel = new sap.ui.model.json.JSONModel();
        let sPath = "/RFQItems";
        let oFilters = [
          new sap.ui.model.Filter(
            "RfqNumber",
            sap.ui.model.FilterOperator.EQ,
            rfq
          ),
        ];
        oModel.read(sPath, {
          filters: oFilters,
          success: function (oData) {
            // Create unique set of MaterialDesc and MaterialNumber pairs
            const uniqueMaterials = [
              ...new Map(
                oData.results.map((item) => [
                  item.MaterialDesc,
                  {
                    MaterialDesc: item.MaterialDesc,
                    MaterialNumber: item.MaterialNo,
                  },
                ])
              ).values(),
            ];
            // Prepare data object with both results and unique Materials
            const formattedData = {
              results: oData.results,
              Materials: uniqueMaterials,
            };
            oJSONModel.setData(formattedData);
            this.getView().setModel(oJSONModel, "rfqData");
          }.bind(this),
          error: function (oError) {
            // Handle error
          },
        });
      },

      onBestOfferButtonPress: async function (oEvent) {
        debugger;
        const payload = {
          buyerId: "b1",
          supplierId: this.bidder,
          rfqNumber: this.rfqNumber,
          materialNo: this.matNo,
        };

        // 3. Make the API call using fetch
        try {
          const response = await fetch(
            "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/buyer/bestOffer/message",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            }
          );

          const result = await response.json();

          if (!response.ok) {
            // Handle server-side errors
            MessageToast.show(
              result.error || "Failed to send best price offer."
            );
            console.error("Server error:", result.error);
            return;
          }
          const to = "supplierId-rfqNum-matNum";
          const message = "best offer";
          this.socket.send(JSON.stringify({ type: "Dm", to, message }));
          // 4. On success, show message and update UI
          MessageToast.show("Best offer message sent successfully");
        } catch (error) {
          // Handle network or other errors
          MessageToast.show(
            "An error occurred while sending best offer message"
          );
          console.error("Network or API error:", error);
        }
      },

      onExpectedPriceButtonPress: function (oEvent) {
        var oButton = oEvent.getSource();
        if (!this._oExpectedPricePopover) {
          Fragment.load({
            id: this.getView().getId(),
            name: "com.pricecomp.pricecomp.fragments.ExpectedPricePopover",
            controller: this,
          }).then(
            function (oPopover) {
              this._oExpectedPricePopover = oPopover;
              this.getView().addDependent(this._oExpectedPricePopover);
              this._oExpectedPricePopover.openBy(oButton);
            }.bind(this)
          );
        } else {
          this._oExpectedPricePopover.openBy(oButton);
        }
      },

      onSendPress: async function () {
        const expectedPriceInput = this.getView().byId("expectedPriceInput");
        const expectedPrice = expectedPriceInput.getValue();

        // 1. Basic validation
        if (!expectedPrice || isNaN(parseFloat(expectedPrice))) {
          MessageToast.show("Please enter a valid expected price.");
          return;
        }

        // Assume these values are available from other UI controls or a model
        // const buyerId = this.getView().getModel("appModel").getProperty("/buyerId");
        // const supplierId = this.getView().getModel("appModel").getProperty("/supplierId");
        // const rfqNumber = this.getView().getModel("appModel").getProperty("/rfqNumber");
        // const materialNo = this.getView().getModel("appModel").getProperty("/materialNo");

        // 2. Prepare the payload for the backend
        const payload = {
          buyerId: "b1",
          supplierId: this.bidder,
          rfqNumber: this.rfqNumber,
          materialNo: this.matNo,
          expectedPrice: parseFloat(expectedPrice),
        };

        // 3. Make the API call using fetch
        try {
          const response = await fetch(
            "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/buyer/expected-price",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(payload),
            }
          );

          const result = await response.json();

          if (!response.ok) {
            // Handle server-side errors
            MessageToast.show(result.error || "Failed to send expected price.");
            console.error("Server error:", result.error);
            return;
          }
          const to = "supplierId-rfqNum-matNum";
          const message = "expected price ";
          this.socket.send(JSON.stringify({ type: "Dm", to, message }));
          // 4. On success, show message and update UI
          MessageToast.show("Expected price sent successfully!");
          expectedPriceInput.setValue("");
          if (this._oExpectedPricePopover) {
            this._oExpectedPricePopover.close();
          }
        } catch (error) {
          // Handle network or other errors
          MessageToast.show("An error occurred while sending the price.");
          console.error("Network or API error:", error);
        }
      },

      onNegotiateButtonPress: function (oEvent) {
        debugger;
        const oModel = this.getView().getModel("toolTipModel");
        this.bidder = oEvent
          .getSource()
          .getBindingContext("toolTipModel")
          .getObject().Bidder;
        var oButton = oEvent.getSource();
        oButton.setVisible(false);
        console.log("Negotiate button clicked");
        const acceptBtn = oEvent.getSource().getParent().getItems()[4]
          .mAggregations.items[0];
        const rejectBtn = oEvent.getSource().getParent().getItems()[4]
          .mAggregations.items[1];
        const oExpectedPriceButton = oEvent
          .getSource()
          .getParent()
          .getItems()[1];
        const oBestOfferButton = oEvent.getSource().getParent().getItems()[2];
        const messageStrip = oEvent.getSource().getParent().getItems()[3];

        if (
          oEvent.getSource().getBindingContext("toolTipModel").getObject()
            .status == "pending"
        ) {
          if (
            oEvent.getSource().getBindingContext("toolTipModel").getObject()
              .readByBuyer == false &&
            oEvent.getSource().getBindingContext("toolTipModel").getObject()
              .bestOffer
          ) {
            messageStrip.setText = `Best offer sent by supplier is ${
              oEvent.getSource().getBindingContext("toolTipModel").getObject()
                .bestOffer
            }`;
          }
          messageStrip.setVisible(true);
          acceptBtn.setVisible(true);
          rejectBtn.setVisible(true);
        } else {
          oExpectedPriceButton.setVisible(true);
          oBestOfferButton.setVisible(true);
        }
      },

      onGoBackPress: function (oEvent) {
        // Get the list bound to toolTipModel>/Negotiation
        const oList = this.byId("chatPageID").getContent()[0]; // Assuming the List is the first content of the page
        const aItems = oList.getItems();

        // Iterate through all list items to reset visibility
        aItems.forEach((oItem) => {
          // Access the second HBox (index 1) in CustomListItem content
          const oSecondHBox = oItem.getContent()[1]; // HBox with Avatar, Text, and VBox
          if (
            oSecondHBox &&
            oSecondHBox.getMetadata().getName() === "sap.m.HBox"
          ) {
            // Access the VBox (third item in second HBox, index 2)
            const oVBox = oSecondHBox.getItems()[2]; // VBox containing buttons and text
            if (oVBox && oVBox.getMetadata().getName() === "sap.m.VBox") {
              const aVBoxItems = oVBox.getItems();
              // Access controls within VBox
              const negotiationButton = aVBoxItems[0]; // idNegotiateButton
              const expPriceBtn = aVBoxItems[1]; // idExpectedPriceButton
              const bestOfferBtn = aVBoxItems[2]; // idBestOfferButton
              const messageStripe = aVBoxItems[3]; // idBestOfferText
              const buttonHBox = aVBoxItems[4]; // HBox with Accept/Reject buttons
              const acceptBtn = buttonHBox.getItems()[0]; // idAcceptButton
              const rejectBtn = buttonHBox.getItems()[1]; // idRejectButton

              // Reset visibility
              negotiationButton.setVisible(true);
              expPriceBtn.setVisible(false);
              bestOfferBtn.setVisible(false);
              messageStripe.setVisible(false);
              acceptBtn.setVisible(false);
              rejectBtn.setVisible(false);
            } else {
              console.error("VBox not found or incorrect control type:", oVBox);
            }
          } else {
            console.error(
              "Second HBox not found or incorrect control type:",
              oSecondHBox
            );
          }
        });

        // Navigate back to the first page
        const oNavContainer = this.byId("idNavContainer");
        const oFirstPage = this.byId("master");
        oNavContainer.to(oFirstPage);

        // ARIA handling
        this.byId("toolPopover").addAriaDescribedBy(this.byId("master"));
        this.byId("toolPopover").focus();
      },

      onStandardListItemPress: async function (oEvent) {
        let oItem = oEvent.getSource();
        const selectedMaterial = oItem
          .getBindingContext("rfqData")
          .getObject().MaterialNumber;
        this.matNo = selectedMaterial;
        let sMaterialDesc = oItem.getTitle();
        let oRfqData = this.getView()
          .getModel("rfqData")
          .getProperty("/results");

        // Get or create toolTipModel
        let oToolTipModel =
          this.getView().getModel("toolTipModel") ||
          new sap.ui.model.json.JSONModel();

        // Filter results by MaterialDesc to get Bidder and Quotation Price
        let aNegotiationData = oRfqData
          .filter((item) => item.MaterialDesc === sMaterialDesc)
          .map((item) => ({
            Bidder: item.Bidder,
            quotationPrice: item.QuotationValue,
          }));

        // Update negotiation data for each bidder
        await this.onUpdateNegotiationData(
          selectedMaterial,
          aNegotiationData,
          oToolTipModel
        );

        // Set the model to the view
        this.getView().setModel(oToolTipModel, "toolTipModel");

        // Socket registration for each bidder
        const sRfqNumber = this.rfqNumber; // Assuming rfqNumber is available in the controller
        aNegotiationData.forEach((item) => {
          const roomInfo = `buyerId-${sRfqNumber}-${selectedMaterial}-${item.Bidder}`;
          this.socket.send(
            JSON.stringify({
              type: "register",
              roomInfo,
            })
          );
        });

        // Navigate to the Negotiation Tool page
        let oNavContainer = this.byId("idNavContainer");
        let oPage = this.byId("chatPageID");
        oNavContainer.to(oPage);

        // ARIA handling
        this.byId("toolPopover").addAriaDescribedBy(this.byId("chatPageID"));
        this.byId("toolPopover").focus();
      },

      onUpdateNegotiationData: async function (
        selectedMaterial,
        aNegotiationData,
        oToolTipModel
      ) {
        // Optional: Show a busy indicator while fetching data
        this.getView().setBusy(true);

        try {
          // Iterate through each bidder and fetch negotiation data
          const updatedNegotiationData = await Promise.all(
            aNegotiationData.map(async (item) => {
              const oLatestRecord = await this._getNewNegotiationData(
                selectedMaterial,
                item.Bidder
              );
              if (oLatestRecord && oLatestRecord.supplierId === item.Bidder) {
                // Merge fetched message data with existing item
                return {
                  Bidder: item.Bidder,
                  quotationPrice: item.quotationPrice,
                  ...oLatestRecord, // Include all fields from the API message (e.g., expectedPrice, bestOffer, status)
                };
              }
              // Return original item if no new data or mismatched supplierId
              return item;
            })
          );

          // Set the updated data to the /Negotiation path in the model
          oToolTipModel.setProperty("/Negotiation", updatedNegotiationData);
          oToolTipModel.refresh(); // Force UI refresh to ensure bindings update

          if (
            updatedNegotiationData.some(
              (item) =>
                item.hasOwnProperty("bestOffer") ||
                item.hasOwnProperty("expectedPrice")
            )
          ) {
            sap.m.MessageToast.show("Negotiation data updated successfully!");
          } else {
            sap.m.MessageToast.show("No new negotiation data available.");
          }
        } catch (error) {
          sap.m.MessageToast.show("Failed to update data: " + error.message);
        } finally {
          this.getView().setBusy(false);
        }
      },

      _getNewNegotiationData: async function (selectedMaterial, supplierId) {
        const sBuyerId = "b1"; // Replace with dynamic value from your UI
        const sSupplierId = supplierId; // Use the passed supplierId
        const sRfqNumber = this.rfqNumber; // Replace with dynamic value from your UI
        const sMaterialNo = selectedMaterial;

        const sUrl = `https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/latest?buyerId=${sBuyerId}&supplierId=${sSupplierId}&rfqNumber=${sRfqNumber}&materialNo=${sMaterialNo}`;

        try {
          const response = await fetch(sUrl);
          const data = await response.json();

          if (data.success && data.message) {
            // Return the message object containing negotiation data
            return data.message;
          } else {
            console.error(
              "API error:",
              data.error || "No message data returned"
            );
            return null;
          }
        } catch (error) {
          console.error("Fetch error:", error);
          throw new Error("Could not connect to the backend.");
        }
      },

      onAcceptButtonPress: async function (oEvent) {
        // oEvent.getSource().getBindingContext('toolTipModel').getObject()._id use this
        // The backend now only requires the messageId
        const sMessageId = oEvent
          .getSource()
          .getBindingContext("toolTipModel")
          .getObject()._id;
        const acceptBtn = oEvent.getSource().getParent().mAggregations.items[1];
        const rejectBtn = oEvent.getSource();
        // Validate that the message ID exists
        if (!sMessageId) {
          sap.m.MessageToast.show("Missing message ID.");
          return;
        }

        // Show a busy indicator
        this.getView().setBusy(true);

        try {
          const response = await fetch(
            "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/buyer/accept",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messageId: sMessageId,
              }),
            }
          );

          const result = await response.json();

          if (result.success) {
            // await this.onUpdateNegotiationData()
            const messageStripe = oEvent
              .getSource()
              .getParent()
              .getParent()
              .getItems()[3];
            messageStripe.setText = "You accepted the offer";
            acceptBtn.setVisible(false);
            rejectBtn.setVisible(false);
            sap.m.MessageToast.show("Offer accepted successfully!");
            // Refresh the messages to show the updated status
          } else {
            sap.m.MessageToast.show(result.error || "Failed to accept offer.");
          }
        } catch (error) {
          sap.m.MessageToast.show("An error occurred: " + error.message);
        } finally {
          this.getView().setBusy(false);
        }
      },

      onRejectButtonPress: async function (oEvent) {
        const acceptBtn = oEvent.getSource().getParent().mAggregations.items[0];
        const rejectBtn = oEvent.getSource();
        const sMessageId = oEvent
          .getSource()
          .getBindingContext("toolTipModel")
          .getObject()._id;

        if (!sMessageId) {
          sap.m.MessageToast.show("Missing message ID.");
          return;
        }

        // 2. Show a busy indicator for better user experience
        this.getView().setBusy(true);

        try {
          const response = await fetch(
            "https://chat_micro_service.cfapps.ap10.hana.ondemand.com/api/chat/buyer/reject",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                messageId: sMessageId,
              }),
            }
          );

          const result = await response.json();

          if (result.success) {
            const messageStripe = oEvent
              .getSource()
              .getParent()
              .getParent()
              .getItems()[3];

            messageStripe.setText = "Offer Rejected";
            acceptBtn.setVisible(false);
            rejectBtn.setVisible(false);
            sap.m.MessageToast.show("Offer rejected ");
            // 3. Call a function to refresh the chat, which reloads the data from the server
            // if (this.onLoadMessages) {
            //   this.onLoadMessages();
            // }
          } else {
            sap.m.MessageToast.show(result.error || "Failed to reject offer.");
          }
        } catch (error) {
          sap.m.MessageToast.show("An error occurred: " + error.message);
        } finally {
          // 4. Always hide the busy indicator
          this.getView().setBusy(false);
        }
      },

      formatPercentageScore: function (fScore) {
        // If fScore is null, undefined, or not a valid number, default to 0
        const fNumericScore =
          fScore === null || fScore === undefined || isNaN(fScore) ? 0 : fScore;

        // Return the score formatted to 1 decimal place
        return Number(fNumericScore).toFixed(1);
      },
    });
  }
);
