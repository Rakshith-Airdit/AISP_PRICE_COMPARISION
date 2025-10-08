sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/BindingMode",
    "sap/viz/ui5/controls/common/feeds/FeedItem",
    "sap/viz/ui5/format/ChartFormatter",
    "sap/viz/ui5/api/env/Format",
  ],
  function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    MessageToast,
    MessageBox,
    BindingMode,
    FeedItem,
    ChartFormatter,
    Format
  ) {
    "use strict";

    return Controller.extend(
      "com.pricecomp.pricecomp.controller.CompareQuotation",
      {
        onInit: function () {
          this.getOwnerComponent()
            .getRouter()
            .getRoute("RouteCompareQuotation")
            .attachPatternMatched(this._onRouteMatched, this);

          Format.numericFormatter(ChartFormatter.getInstance());

          // Initialize models
          this.getView().setModel(new JSONModel(), "compareQuotations");
          this.getView().setModel(new JSONModel(), "priceAnalysis");
          this.getView().setModel(new JSONModel(), "scoreAnalysis");
        },

        _onRouteMatched: function (oEvent) {
          var rfqNum = oEvent.getParameters().arguments.rfqnumber;
          var bidders = oEvent.getParameters().arguments.bidders;

          this.rfqNum = rfqNum;

          if (!rfqNum) {
            MessageBox.error("RFQ Number is required");
            return;
          }
          if (!bidders) {
            MessageBox.error("No bidders Selected to Compare");
            return;
          }
          let aBidderIDS = [...new Set(bidders.split(","))];

          this._loadSupplierData(rfqNum, aBidderIDS);
        },

        _loadSupplierData: function (rfqNum, aBidderIDS) {
          const oModel = this.getOwnerComponent().getModel();

          // Create filters array
          const aFilters = [new Filter("RfqNumber", FilterOperator.EQ, rfqNum)];

          // Add bidder filters using OR condition
          if (aBidderIDS && aBidderIDS.length > 0) {
            const bidderFilters = aBidderIDS.map(
              (bidderId) => new Filter("Bidder", FilterOperator.EQ, bidderId)
            );

            // Create OR filter for all bidder IDs
            const bidderOrFilter = new Filter({
              filters: bidderFilters,
              and: false, // This creates an OR condition
            });

            aFilters.push(bidderOrFilter);
          }

          console.log("Applying filters:", aFilters);

          oModel.read("/RFQSuppliers", {
            filters: aFilters,
            success: (oData) => {
              if (oData.results && oData.results.length > 0) {
                // Calculate Lowest/Highest Price Status
                const aProcessedResults =
                  this._calculatePriceVsLowestAndHighest(oData.results);

                // Set the supplier data
                this.getView().getModel("compareQuotations").setData({
                  results: aProcessedResults,
                });

                // Prepare and set chart data
                this._prepareChartData(oData.results);
              } else {
                MessageBox.information("No suppliers found for this RFQ");
              }
            },
            error: (oError) => {
              MessageBox.error(
                "Failed to load supplier data: " + oError.message
              );
            },
          });
        },

        _calculatePriceVsLowestAndHighest: function (aQuotes) {
          if (!aQuotes || aQuotes.length === 0) return aQuotes;

          // 1. Find the lowest and highest quote values
          let fLowestValue = Infinity;
          let fHighestValue = -Infinity;

          aQuotes.forEach((oQuote) => {
            // Ensure the value is a number for comparison
            const fValue = parseFloat(oQuote.QuotationValue);

            if (!isNaN(fValue)) {
              if (fValue < fLowestValue) {
                fLowestValue = fValue;
              }
              if (fValue > fHighestValue) {
                fHighestValue = fValue;
              }
            }
          });

          // 2. Calculate the difference/status for each quote
          aQuotes.forEach((oQuote) => {
            const fCurrentValue = parseFloat(oQuote.QuotationValue);
            const sCurrency = oQuote.Currency || ""; // Ensure currency exists

            if (isNaN(fCurrentValue)) {
              // Handle invalid data gracefully
              oQuote.PriceVsLowestDifference = "N/A";
              oQuote.IsLowest = false;
              oQuote.IsHighest = false;
              oQuote.PriceVsHighestDifference = "N/A";
              return;
            }

            // --- Lowest Price Fields ---
            // Difference from lowest (always positive or zero)
            oQuote.PriceVsLowestDifference = (
              fCurrentValue - fLowestValue
            ).toFixed(2);
            oQuote.IsLowest = fCurrentValue === fLowestValue;

            // --- Highest Price Fields ---
            oQuote.IsHighest = fCurrentValue === fHighestValue;
            // Difference from highest (always positive or zero, used to show savings)
            oQuote.PriceVsHighestDifference = (
              fHighestValue - fCurrentValue
            ).toFixed(2);
          });

          return aQuotes; // Return the enriched array
        },

        formatPriceStatusCombinedText: function (
          sDifference,
          bIsLowest,
          bIsHighest,
          sCurrency
        ) {
          if (bIsLowest) {
            return "Lowest";
          }

          if (bIsHighest) {
            return "Highest";
          }

          // Safety check for invalid data
          if (sDifference === "N/A" || !sCurrency) {
            return "";
          }

          // If neither lowest nor highest, show the difference from the lowest
          return `+${sDifference} ${sCurrency}`;
        },

        formatPriceStatusCombinedState: function (bIsLowest, bIsHighest) {
          if (bIsLowest) {
            return "Success"; // Lowest is good (Green)
          }

          if (bIsHighest) {
            return "Error"; // Highest is bad (Red)
          }

          return "Information"; // Middle quotes (Blue/Grey)
        },

        _prepareChartData: function (suppliers) {
          // Extract unique suppliers and materials
          const uniqueSuppliers = [...new Set(suppliers.map((s) => s.Bidder))];
          const uniqueMaterials = new Set();

          // Collect all unique materials
          suppliers.forEach((supplier) => {
            if (supplier.Items && Array.isArray(supplier.Items)) {
              supplier.Items.forEach((item) => {
                uniqueMaterials.add(item.MaterialDesc);
              });
            }
          });

          const materialArray = Array.from(uniqueMaterials).sort();
          const heatmapData = [];

          console.log("Unique Suppliers:", uniqueSuppliers);
          console.log("Unique Materials:", materialArray);

          // Create the matrix data
          uniqueSuppliers.forEach((supplierId) => {
            materialArray.forEach((materialName) => {
              // Find the supplier data
              const supplierData = suppliers.find(
                (s) => s.Bidder === supplierId
              );
              let price = 0;

              if (
                supplierData &&
                supplierData.Items &&
                Array.isArray(supplierData.Items)
              ) {
                // Find the matching material
                const item = supplierData.Items.find(
                  (item) => item.MaterialDesc === materialName
                );
                price = item ? item.Netpr || 0 : 0;
              }

              heatmapData.push({
                Supplier: supplierId,
                Material: materialName,
                Price: price,
              });
            });
          });

          console.log("Final Heatmap Data:", heatmapData);

          // Set data to model
          const oPriceModel = this.getView().getModel("priceAnalysis");
          oPriceModel.setData(heatmapData);

          // Prepare score data
          const scoreData = suppliers.map((supplier) => ({
            Supplier: supplier.Bidder,
            Score: supplier.TOTAL_SCORE || 0,
          }));
          debugger;

          this.getView().getModel("scoreAnalysis").setData(scoreData);

          this._initializeHeatmapChart();
        },

        _initializeHeatmapChart: function () {
          const oPriceModel = this.getView().getModel("priceAnalysis");
          const oVizFrame = this.getView().byId("idVizFrame");
          if (!oVizFrame) {
            console.error("VizFrame not found!");
            return;
          }

          console.log("Initializing heatmap chart...");

          // Get the dataset
          const oDataset = oVizFrame.getDataset();
          if (!oDataset) {
            console.error("Dataset not found!");
            return;
          }

          // Log dataset info
          console.log("Dataset dimensions:", oDataset.getDimensions());
          console.log("Dataset measures:", oDataset.getMeasures());

          // Set viz properties (minimal to avoid conflicts)
          oVizFrame.setVizProperties({
            plotArea: {
              dataLabel: {
                visible: true,
                formatString: "0.00",
              },
              colorPalette: [
                "#e0f3f8",
                "#abd9e9",
                "#74add1",
                "#4575b4",
                "#313695",
              ],
              nullValueColor: "#f5f5f5",
            },
            title: {
              visible: false,
            },
            legend: {
              title: {
                visible: false,
              },
            },
            valueAxis: {
              title: {
                visible: false,
              },
            },
            categoryAxis: {
              title: {
                visible: false,
              },
            },
          });

          oVizFrame.setModel(oPriceModel);

          // Attach event listeners for debugging
          oVizFrame.attachEventOnce("updatedData", function () {
            console.log("✓ Heatmap data updated successfully!");
          });

          oVizFrame.attachEventOnce("renderFinished", function () {
            console.log("✓ Heatmap render finished!");
          });
        },

        formatScoreState: function (score) {
          if (score >= 80) return "Success";
          if (score >= 60) return "Information";
          if (score >= 40) return "Warning";
          return "Error";
        },

        // Optional: Format currency
        formatCurrency: function (value, currency) {
          if (!value) return "";
          const formattedValue = parseFloat(value).toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          return `${formattedValue} ${currency || "INR"}`;
        },

        // Optional: Format material information
        formatMaterialInfo: function (material) {
          return `${material.MaterialDesc} (${material.MaterialNo}) - Qty: ${material.Quantity} ${material.UnitOfMeasure}`;
        },

        _navigateBack: function () {
          this.getOwnerComponent().getRouter().navTo("RouteCompareRFQ", {
            rfqNum: this.rfqNum,
          });
        },

        onPressCard: function () {
          alert("Card Action Pressed");
        },

        onSummaryButtonPress: function (oEvent) {
          var oCard = oEvent.getSource().getParent().getParent();

          var oBindingContext = oCard.getBindingContext("compareQuotations");
          var sBidder = oBindingContext.getProperty("Bidder");
          var sQuotationNo = oBindingContext.getProperty("SupplierQuotation");
          debugger;
        },
      }
    );
  }
);
