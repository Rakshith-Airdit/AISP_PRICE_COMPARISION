/*global QUnit*/

sap.ui.define([
	"com/pricecomp/pricecomp/controller/RFQPriceList.controller"
], function (Controller) {
	"use strict";

	QUnit.module("RFQPriceList Controller");

	QUnit.test("I should test the RFQPriceList controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
