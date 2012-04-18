var heartbeatTimer = 0;
var xmlBuffer = "";
var updateComplete = false;
var digitalJoinRepeat = [];
var analogJoinValue = [];
var xmlParser = new DOMParser();
var lastDataReceived = 0;
var forceDisconnected = false;

var CrestronMobile = {
	sendData:function (data) {
		if (updateComplete) {
			CF.send("CrestronMobile", data);
		}
	},

	//Function to decode UTF text for serial strings
	decode:function (utftext) {
		return decodeURIComponent(escape(utftext));
	},

	onButtonPressed:function (join) {
		if (CF.debug) {
			CF.log("onButtonPressed join=" + join);
		}
		var id = join.substring(1);
		var data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
		CrestronMobile.sendData(data);
		digitalJoinRepeat[id] = setInterval("CrestronMobile.sendData('" + data + "')", 500);
	},

	onButtonReleased:function (join) {
		var id = join.substring(1);
		clearInterval(digitalJoinRepeat[id]);
		CrestronMobile.sendData("<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>");
	},

	onAnalogChanged:function (join, value) {
		var id = join.substring(1);
		var v = parseInt(value,10) / 655;
		if (analogJoinValue[id] !== v) {
			CrestronMobile.sendData("<cresnet><data><i32 id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>");
			analogJoinValue[id] = v;
		}
	},

	onSerialChanged:function (join, value) {
		CrestronMobile.sendData("<cresnet><data><string id=\"" + join.substring(1) + "\" value=\"" + value + "\"/></data></cresnet>");
	},

	onSystemConnectionChanged:function (system, connected, remote) {
		if (CF.debug) {
			CF.log("onSystemConnectionChanged system=" + system + ", connected=" + connected + ", remote=" + remote);
		}
		if (connected === 0) {
			var i, joins = [];

			// Reset heartbeat timer
			if (heartbeatTimer !== 0) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = 0;
			}
			updateComplete = false;

			//Digital Joins: Loop through the joins, starting at 1 and add to the joins array
			for (i = 1; i <= 4000; i++) {
				joins.push({
					join:"d" + i,
					value:0
				});
			}
			CF.setJoins(joins,false);
			joins = [];

			//Analog Joins: Loop through the joins, starting at 1 and add to the joins array
			for (i = 1; i <= 4000; i++) {
				joins.push({
					join:"a" + i,
					value:0
				});
			}
			CF.setJoins(joins);
			joins = [];

			//Serial Joins: Loop through the joins, starting at 1 and add to the joins array
			for (i = 1; i <= 4000; i++) {
				joins.push({
					join:"s" + i,
					value:""
				});
			}
			CF.setJoins(joins,false);
			analogJoinValue = [];
			lastDataReceived = 0;
			xmlBuffer = 0;
		}
	},

	sendHeartBeat:function () {
		// If we haven't received a reply to the last heartbeat, disconnect and reconnect
		if ((Date.now() - lastDataReceived) > 6000) {
			if (CF.debug) {
				CF.log("Crestron did not respond to the last heartbeat message, disconnecting and reconnecting.");
			}
			clearInterval(heartbeatTimer);
			heartbeatTimer = 0;
			CF.setSystemProperties("CrestronMobile",{enabled:false});
			setTimeout(function() { CF.setSystemProperties("CrestronMobile",{enabled:true}); }, 100);
		} else {
			CrestronMobile.sendData("<cresnet><control><comm><heartbeatRequest><data></data></heartbeatRequest></comm></control></cresnet>");
		}
	},

	parseXML:function (xmlData) {
		var tree, v, updates = [], j, n, elems, elem, begin, end, last = -1, xml;
		if (xmlData != null) {
			xmlBuffer += xmlData;
		}
		CF.log("parseXML: buffer=");
		CF.log(xmlBuffer);
		begin = xmlBuffer.indexOf("<cresnet>");
		while (begin >= 0) {
			end = xmlBuffer.indexOf("</cresnet>", begin+8);
			if (end === -1) {
				break;
			}
			last = end + 10;
			xml = xmlBuffer.substring(begin, last);
			try {
				tree = xmlParser.parseFromString(xml, "text/xml");
				if (xml.indexOf("<bool") > 0) {
					//Found Digital(bool) Element, get all instances in message and parse
					elems = tree.getElementsByTagName("bool");
					for (j = 0, n = elems.length; j < n; j++) {
						elem = elems[j];
						updates.push({
							join: "d" + elem.getAttributeNode("id").nodeValue,
							value: (elem.getAttributeNode("value").nodeValue === "true") ? 1 : 0
						});
					}
				} else if (xml.indexOf("<string") > 0) {
					//Found Serial(string) Element, get all instances in message and parse	
					elems = tree.getElementsByTagName("string");
					for (j = 0, n = elems.length; j < n; j++) {
						elem = elems[j];
						if (xml.indexOf("value=") > 0) {
							v = elem.getAttributeNode("value").nodeValue;
						} else if (xml.indexOf("></string>") > 0) {
							v = "";
						} else {
							v = elem.childNodes[0].nodeValue;
						}
						updates.push({
							join: "s" + elem.getAttributeNode("id").nodeValue,
							value: CrestronMobile.decode(v)
						});
					}
				} else if (xml.indexOf("<i32") > 0) {
					//Found Analog(i32) Element, get all instances in message and parse							
					elems = tree.getElementsByTagName("i32");
					n = elems.length;
					for (j = 0; j < n; j++) {
						elem = elems[j];
						if (xml.indexOf("value=") > 0) {
							v = elem.getAttributeNode("value").nodeValue;
						} else {
							v = elem.childNodes[0].nodeValue;
						}
						updates.push({
							join:"a" + elem.getAttributeNode("id").nodeValue,
							value:v
						});
					}
				}
			} catch (ex) {
				if (CF.debug) {
					CF.log("Exception catched while parsing XML: " + ex + ", XML being parsed:");
					CF.log(xml);
				}
			}
			// move to next section
			begin = xmlBuffer.indexOf("<cresnet>", last);
		}
		if (last !== -1 && last < xmlBuffer.length) {
			xmlBuffer = xmlBuffer.slice(last);
		} else {
			xmlBuffer = "";
		}
		//Update Joins on Panel
		if (updates.length !== 0) {
			CF.setJoins(updates, false);
		}
	},

	processFeedback: function(fbname, str) {
		if (updateComplete) {
			// Common case: parse updates & heartbeat responses
			lastDataReceived = Date.now();
			CrestronMobile.parseXML(str);
		} else if (str.indexOf("<programReady><status>02") > 0) {
			//Found Program Ready Message, send Connect Request to system
			CF.send("CrestronMobile", "<cresnet><control><comm><connectRequest><passcode>1234</passcode><mode isUnicodeSupported=\"true\"></mode></connectRequest></comm></control></cresnet>");
		} else if (str.indexOf("<connectResponse>") > 0) {
			//Found Connect Response Message, validate response
			if (str.indexOf("<code>0</code>") > 0) {
				//Connection is good, send Update Request Message to system
				CF.send("CrestronMobile", "<cresnet><data><updateRequest></updateRequest></data></cresnet>");
			}
		} else {
			xmlBuffer = xmlBuffer + str;
			if (xmlBuffer.indexOf("endOfUpdate") > 0) {
				//Update Finished, begin sending Heartbeat Message
				CrestronMobile.parseXML(null);
				updateComplete = true;
				lastDataReceived = Date.now();
				heartbeatTimer = setInterval(CrestronMobile.sendHeartBeat, 5000);
			}
		}
	}
};

CF.userMain = function () {
	var digitalJoins = [];
	var analogJoins = [];
	var serialJoins = [];

	for (var i = 1; i <= 4000; i++) {
		digitalJoins.push("d" + i);
		analogJoins.push("a" + i);
		serialJoins.push("s" + i);
	}

	CF.watch(CF.ConnectionStatusChangeEvent, "CrestronMobile", CrestronMobile.onSystemConnectionChanged, true);
	CF.watch(CF.FeedbackMatchedEvent, "CrestronMobile", "Feedback", CrestronMobile.processFeedback);
	CF.watch(CF.ObjectPressedEvent, digitalJoins, CrestronMobile.onButtonPressed);
	CF.watch(CF.ObjectReleasedEvent, digitalJoins, CrestronMobile.onButtonReleased);
	CF.watch(CF.ObjectDraggedEvent, analogJoins, CrestronMobile.onAnalogChanged);
	CF.watch(CF.JoinChangeEvent, serialJoins, CrestronMobile.onSerialChanged);
};
