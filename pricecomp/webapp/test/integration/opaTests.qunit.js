/* global QUnit */
QUnit.config.autostart = false;

sap.ui.require(["com/pricecomp/pricecomp/test/integration/AllJourneys"
], function () {
	QUnit.start();
});
