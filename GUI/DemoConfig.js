//
// DemoConfig.js
//
// Automatic CrestronMobile configuration based on presence of JSON objects
//
// During setup, CrestronMobile looks whether you have globally defined objects whose name
// obey a special pattern:
//
// CrestronMobileConfig_{system name}
//
// It does so by going through all the external TCP systems defined in your GUI, using the
// system name to assemble the full variable name. If such a variable exists and is an object
// containing properties, CrestronMobile will initialize a new CrestronMobile object talking to this
// system and will use the object properties to configure it.
//
// See the comments below for a list of the properties you can define.
//

var CrestronMobileConfig_CrestronMobile = {
	// A list of pages for which we are monitoring all joins of. A page name can be a regular expression
	// In a given page, joins of all elements (including elements in referenced subpages) will be processed
	// If you omit this property or set it to null or to an empty array, all pages will be looked at.
	pages: [".*"],

	// An optional additional list of joins we also want to handle,
	// that don't match objects in defined pages
	additionalJoins: [],

	// An optional exclusion list that allows you to exclude joins in the relevant pages
	// from interaction with the Crestron processor
	excludedJoins: ["d9000"],

	// The password to use to connect to this Crestron processor
	password: "1234"

};
