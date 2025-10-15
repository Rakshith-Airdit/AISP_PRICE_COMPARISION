sap.ui.define(
  ["sap/ui/core/mvc/Controller", "sap/ui/core/Fragment"],
  (Controller, Fragment) => {
    "use strict";

    return Controller.extend(
      "com.pricecomp.pricecomp.controller.RFQPriceList",
      {
        onInit() {
          this.router = this.getOwnerComponent().getRouter();
          this.router
            .getRoute("RouteRFQPriceList")
            .attachPatternMatched(this.onRouteMatched, this);
        },

        onStatusFilterChange: function (oEvent) {
          // 1. Get the MultiComboBox control
          const oMultiComboBox = oEvent.getSource();
          // 2. Get the currently selected keys (Status codes)
          const aSelectedKeys = oMultiComboBox.getSelectedKeys();

          // 3. Get the SmartFilterBar control
          const oSmartFilterBar = this.byId("smartFilterBar");

          // 4. Manually update the filter state of the SmartFilterBar
          const oSmartFilterData = oSmartFilterBar.getFilterData();

          if (aSelectedKeys.length > 0) {
            // Create an array of condition objects for the MultiComboBox.
            // The SmartFilterBar expects conditions in its internal format (a set of Ranges/Conditions).
            const aConditions = aSelectedKeys.map((sKey) => ({
              key: "Status",
              operation: "EQ",
              value1: sKey,
            }));

            // Update the filter data for the 'Status' key
            oSmartFilterData.Status = aConditions;
          } else {
            // If no keys are selected, clear the filter for Status
            delete oSmartFilterData.Status;
          }

          oSmartFilterBar.setFilterData(oSmartFilterData, true);
        },

        // onBeforeRebindTable: function (oEvent) {
        //   const mBindingParams = oEvent.getParameter("bindingParams");

        //   mBindingParams.sorter = [];

        //   const oSorter = new sap.ui.model.Sorter("EventStartDate", true);
        //   mBindingParams.sorter.push(oSorter);
        // },

        onBeforeRebindTable: function (oEvent) {
          const oBindingParams = oEvent.getParameter("bindingParams");

          if (!oBindingParams.sorter || oBindingParams.sorter.length === 0) {
            const oDefaultSorter = new sap.ui.model.Sorter(
              "EventStartDate",
              true
            ); // true = descending

            oBindingParams.sorter.push(oDefaultSorter);
          }
        },

        onCreateRFQ: function () {
          var oView = this.getView(),
            oButton = oView.byId("idCreateRFQBtn");

          if (!this._oCreateNewRFQFragment) {
            this._oCreateNewRFQFragment = Fragment.load({
              id: oView.getId(),
              name: "com.pricecomp.pricecomp.fragments.createNewRFQMenu",
              controller: this,
            }).then(
              function (oMenu) {
                oMenu.openBy(oButton);
                this._oCreateNewRFQFragment = oMenu;
                return this._oCreateNewRFQFragment;
              }.bind(this)
            );
          } else {
            this._oCreateNewRFQFragment.openBy(oButton);
          }
        },

        onPressCreateRFQMaterial: function (oEvent) {
          this.getOwnerComponent().getRouter().navTo("RouteCreateMaterialRFQ");
        },

        onPressCreateRFQService: function (oEvent) {
          this.getOwnerComponent().getRouter().navTo("RouteCreateServiceRFQ");
        },

        onRFQListItemPress: function (oEvent) {
          let oSource = oEvent.getSource();
          let oContext = oSource.getBindingContext();
          let oData = oContext.getObject();
          let { RfqNumber } = oData;

          this.getOwnerComponent().getRouter().navTo("RouteCompareRFQ", {
            rfqNum: RfqNumber,
          });
        },

        formatStatusState: function (sStatus) {
          switch (sStatus) {
            case "Open":
              return "Indication13";
            case "Completed":
              return "Indication14";
            case "Accepted":
              return "Indication15";
            case "Action needed":
              return "Indication11";
            default:
              return "None";
          }
        },

        // formatTimeRemaining: function (deadlineTimestamp) {
        //   console.log(deadlineTimestamp);

        //   // Handle null/undefined/empty values
        //   if (!deadlineTimestamp) {
        //     return "No deadline set";
        //   }

        //   // Parse the timestamp whether it comes as string or number
        //   let timestamp;
        //   if (typeof deadlineTimestamp === "string") {
        //     // Handle OData format "/Date(timestamp)/"
        //     const match = deadlineTimestamp.match(/\d+/);
        //     timestamp = match ? parseInt(match[0]) : null;
        //   } else if (typeof deadlineTimestamp === "number") {
        //     // Handle raw timestamp
        //     timestamp = deadlineTimestamp;
        //   } else if (deadlineTimestamp instanceof Date) {
        //     // Handle Date object directly
        //     timestamp = deadlineTimestamp.getTime();
        //   }

        //   // If we couldn't parse a valid timestamp
        //   if (!timestamp) {
        //     return "Invalid deadline";
        //   }

        //   const deadlineDate = new Date(timestamp);
        //   const now = new Date();
        //   const diffMs = deadlineDate - now;

        //   // If deadline has passed
        //   if (diffMs <= 0) {
        //     return "Deadline passed";
        //   }

        //   // Calculate time remaining
        //   const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        //   const diffHours = Math.floor(
        //     (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
        //   );

        //   return `${diffDays}d ${diffHours}h remaining`;
        // },

        // formatTimeRemainingState: function (deadlineTimestamp) {
        //   console.log(deadlineTimestamp);
        //   if (!deadlineTimestamp) {
        //     return "None";
        //   }

        //   // Parse the timestamp (same logic as above)
        //   let timestamp;
        //   if (typeof deadlineTimestamp === "string") {
        //     const match = deadlineTimestamp.match(/\d+/);
        //     timestamp = match ? parseInt(match[0]) : null;
        //   } else if (typeof deadlineTimestamp === "number") {
        //     timestamp = deadlineTimestamp;
        //   } else if (deadlineTimestamp instanceof Date) {
        //     timestamp = deadlineTimestamp.getTime();
        //   }

        //   if (!timestamp) {
        //     return "None";
        //   }

        //   const deadlineDate = new Date(timestamp);
        //   const now = new Date();
        //   const diffMs = deadlineDate - now;

        //   if (diffMs <= 0) {
        //     return "Error";
        //   }

        //   const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        //   console.log(diffDays);

        //   if (diffDays > 3) return "Success";
        //   if (diffDays > 1) return "Warning";
        //   return "Error";
        // },

        calculateProgressPercentage: function (deadlineTimestamp) {
          if (!deadlineTimestamp) {
            return 0;
          }

          // Parse the timestamp (same logic as above)
          let timestamp;
          if (typeof deadlineTimestamp === "string") {
            const match = deadlineTimestamp.match(/\d+/);
            timestamp = match ? parseInt(match[0]) : null;
          } else if (typeof deadlineTimestamp === "number") {
            timestamp = deadlineTimestamp;
          } else if (deadlineTimestamp instanceof Date) {
            timestamp = deadlineTimestamp.getTime();
          }

          if (!timestamp) {
            return 0;
          }

          const deadlineDate = new Date(timestamp);
          const now = new Date();
          const totalDuration = deadlineDate - now;

          // If deadline has passed, show 100%
          if (totalDuration <= 0) {
            return 100;
          }

          // Calculate percentage of time passed (0-100%)
          const timePassed =
            now - new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const percentage = (timePassed / totalDuration) * 100;

          return Math.min(100, Math.max(0, Math.round(percentage)));
        },

        showProgressIndicator: function (deadlineTimestamp) {
          if (!deadlineTimestamp) {
            return false;
          }

          const timestamp = this.parseTimestamp(deadlineTimestamp);
          if (!timestamp) {
            return false;
          }

          const deadlineDate = new Date(timestamp);
          const now = new Date();
          return deadlineDate > now;
        },

        showDeadlinePassedText: function (deadlineTimestamp) {
          if (!deadlineTimestamp) {
            return false;
          }

          const timestamp = this.parseTimestamp(deadlineTimestamp);
          if (!timestamp) {
            return false;
          }

          const deadlineDate = new Date(timestamp);
          const now = new Date();
          return deadlineDate <= now;
        },

        // Helper function to parse timestamp
        parseTimestamp: function (deadlineTimestamp) {
          if (!deadlineTimestamp) {
            return null;
          }

          let timestamp;
          if (typeof deadlineTimestamp === "string") {
            const match = deadlineTimestamp.match(/\d+/);
            timestamp = match ? parseInt(match[0]) : null;
          } else if (typeof deadlineTimestamp === "number") {
            timestamp = deadlineTimestamp;
          } else if (deadlineTimestamp instanceof Date) {
            timestamp = deadlineTimestamp.getTime();
          }

          return timestamp;
        },

        // Update your existing functions to use the helper
        formatTimeRemaining: function (deadlineTimestamp) {
          const timestamp = this.parseTimestamp(deadlineTimestamp);

          if (!timestamp) {
            return "No deadline set";
          }

          const deadlineDate = new Date(timestamp);
          const now = new Date();
          const diffMs = deadlineDate - now;

          if (diffMs <= 0) {
            return "Deadline passed"; // This won't be shown due to conditional visibility
          }

          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          const diffHours = Math.floor(
            (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
          );

          return `${diffDays}d ${diffHours}h remaining`;
        },

        formatTimeRemainingState: function (deadlineTimestamp) {
          const timestamp = this.parseTimestamp(deadlineTimestamp);

          if (!timestamp) {
            return "None";
          }

          const deadlineDate = new Date(timestamp);
          const now = new Date();
          const diffMs = deadlineDate - now;

          if (diffMs <= 0) {
            return "Error"; // This won't be shown due to conditional visibility
          }

          const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
          console.log(diffDays);

          if (diffDays > 3) return "Success";
          if (diffDays > 1) return "Warning";
          return "Error";
        },
        
        formatDate: function (dateValue) {
          if (!dateValue || !(dateValue instanceof Date)) return "-";
          const day = String(dateValue.getDate()).padStart(2, "0");
          const month = String(dateValue.getMonth() + 1).padStart(2, "0");
          const year = dateValue.getFullYear();
          return `${day}-${month}-${year}`;
        },
      }
    );
  }
);
