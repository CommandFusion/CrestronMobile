/* Crestron Mobile Interface
 //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

 AUTHOR:	Greg Soli, Audio Advice
 CONTACT:	greg.soli@audioadvice.com
 VERSION:	v 3.0 beta

 /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 */

var CrestronMobile = {
	//Global Variable Assignments
	debug: true,				// set to true to add CrestronMobile's own debugging messages to the log
	systemName: "",
	initialized : false,
	heartbeatTimer : 0,
	lastDataReceived : 0,
	updateComplete : false,
	digitalJoinRepeat : [],
	analogJoinValue : [],
	aJoin : [],
	dJoin : [],
	sJoin : [],
	aJoinMax : 0,
	dJoinMax : 0,
	sJoinMax : 0,
	gJoinMin : 0,
	gJoinMax : 0,
	password : "1234",
	loggedIn : false,
	connected : false,
	orientation : "2",
	connectionTimer : 0,
	loadingMessageVisible : false,
	loadingMessageSubpage: "d4001",

	setup : function() {
		var digitalJoins = [];
		var analogJoins = [];
		var serialJoins = [];
		var gestureJoins = [];

		if (CrestronMobile.debug) { CF.log("CrestronMobile: setup()"); }

		// Setup unique ports if CrestronUUID was included
		try { CrestronUUID.setup(); } catch(ex) {}

		CrestronMobile.connection("disconnect");
		CF.watch(CF.PreloadingCompleteEvent, CrestronMobile.onGUIPreloadComplete);

		CF.getJoin(CF.GlobalTokensJoin, function(j, v, tokens) {
			CrestronMobile.aJoinMax = tokens["[aJoinMax]"] || 200;
			CrestronMobile.sJoinMax = tokens["[sJoinMax]"] || 200;
			CrestronMobile.dJoinMax = tokens["[dJoinMax]"] || 1000;
			CrestronMobile.password = tokens["[cmPassword]"] || "1234";
			CrestronMobile.gJoinMin = tokens["[gJoinMin]"] || 1001;
			CrestronMobile.gJoinMax = tokens["[gJoinMax]"] || 1050;
			var i;
			for(i = 1; i <= CrestronMobile.dJoinMax; i++) {
				digitalJoins.push("d" + i);
				CrestronMobile.dJoin.push({
					join : "d" + i,
					value : 0
				});
			}
			for(i = 1; i <= CrestronMobile.aJoinMax; i++) {
				analogJoins.push("a" + i);

				CrestronMobile.aJoin.push({
					join : "a" + i,
					value : 0
				});
			}
			for(i = 1; i <= CrestronMobile.sJoinMax; i++) {
				serialJoins.push("s" + i);

				CrestronMobile.sJoin.push({
					join : "s" + i,
					value : ""
				});
			}
			for(i = CrestronMobile.gJoinMin; i <= CrestronMobile.gJoinMax; i++) {
				gestureJoins.push("d" + i);
			}

			if (CrestronMobile.debug) { CF.log("CrestronMobile: dJoinMax="+CrestronMobile.dJoinMax+", aJoinMax="+CrestronMobile.aJoinMax+", sJoinMax="+CrestronMobile.sJoinMax); }

			CF.watch(CF.ConnectionStatusChangeEvent, "CrestronMobile", CrestronMobile.onSystemConnectionChanged, false);
			CF.watch(CF.FeedbackMatchedEvent, "CrestronMobile", "Feedback", CrestronMobile.processFeedback);
			CF.watch(CF.ObjectPressedEvent, digitalJoins, CrestronMobile.onButtonPressed);
			CF.watch(CF.ObjectReleasedEvent, digitalJoins, CrestronMobile.onButtonReleased);
			CF.watch(CF.ObjectDraggedEvent, analogJoins, CrestronMobile.onAnalogChanged);
			CF.watch(CF.JoinChangeEvent, serialJoins, CrestronMobile.onSerialChanged);
			CF.watch(CF.JoinChangeEvent, gestureJoins, CrestronMobile.onDigitalChanged);
			CF.watch(CF.OrientationChangeEvent, CrestronMobile.onOrientationChange, true);
			CF.watch(CF.GUISuspendedEvent, CrestronMobile.onGUISuspended);
			CF.watch(CF.GUIResumedEvent, CrestronMobile.onGUIResumed);
			CF.watch(CF.NetworkStatusChangeEvent, CrestronMobile.onNetworkStatusChange, false);

			CrestronMobile.heartbeatTimer = setInterval(function() {
				CrestronMobile.sendHeartBeat();
			}, 2000);
		});
	},
	resetRunningJoins : function() {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: resetting running joins"); }
		for(var d = 0; d < CrestronMobile.dJoin.length; d++) {
			CrestronMobile.dJoin[d] = {
				join : "d" + (d + 1),
				value : 0
			}
		}
		for(var a = 0; a < CrestronMobile.aJoin.length; a++) {
			CrestronMobile.aJoin[a] = {
				join : "a" + (a + 1),
				value : 0
			}
		}
		for(var s = 0; s < CrestronMobile.sJoin.length; s++) {
			CrestronMobile.sJoin[s] = {
				join : "s" + (s + 1),
				value : ""
			}
		}
	},
	sendData : function(data) {
		CF.send("CrestronMobile", data, CF.UTF8);
		if(CrestronMobile.connected) {

		}
	},
	onGUIPreloadComplete : function() {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: GUI preload complete"); }
		CrestronMobile.connection("connect");
	},
	onNetworkStatusChange : function(networkStatus) {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: networkStatus="+networkStatus); }
		if(networkStatus.hasNetwork === true) {
			CrestronMobile.connection("connect");
		} else {
			CrestronMobile.connection("disconnect");
		}
	},
	onGUISuspended : function() {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: GUI suspended"); }
	},
	onGUIResumed : function() {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: GUI resumed"); }
	},
	onSystemConnectionChanged : function(system, connected, remote) {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: system connected="+connected+", remote="+remote); }
		if (connected) {
			CrestronMobile.updateComplete = false;
			CrestronMobile.connected = true;
		} else {
			CrestronMobile.updateComplete = false;
			if (remote === null) {
				CrestronMobile.connected = false;
			} else {
				//CrestronMobile.connection("reset");
			}
		}
	},
	onOrientationChange : function(pageName, newOrientation) {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: orientation changed, pageName="+pageName+", newOrientation="+newOrientation); }
		var data = "";
		if(newOrientation === CF.LandscapeOrientation) {
			data = "<cresnet><data><i32 id=\"17259\" value=\"2\"/></data></cresnet>";
			CrestronMobile.sendData(data);
			CrestronMobile.orientation = "2";
		} else {
			data = "<cresnet><data><i32 id=\"17259\" value=\"1\"/></data></cresnet>";
			CrestronMobile.sendData(data);
			CrestronMobile.orientation = "1";
		}
	},
	onButtonPressed : function(join, value, tokens) {
		var id = join.substring(1);
		var data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
		CrestronMobile.sendData(data);
		CrestronMobile.digitalJoinRepeat[id] = setInterval(function() {
			CrestronMobile.sendData(data);
		}, 500);
	},
	onButtonReleased : function(join, value, tokens) {
		var id = join.substring(1);
		clearInterval(CrestronMobile.digitalJoinRepeat[id]);
		var data = "<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>";
		CrestronMobile.sendData(data);
	},
	onAnalogChanged : function(join, value) {
		if(CrestronMobile.initialized) {
			var id = join.substring(1);
			var data = "<cresnet><data><i32 id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>";
			CrestronMobile.sendData(data);
		}
	},
	onSerialChanged:function(join, value) {
		//Not Currently Supported By Crestron
/*
		var data;
		var id;
		if (CrestronMobile.initialized === true) {
			id = join.substring(1);

			data = "<cresnet><data  som=\"true\" eom=\"true\"><string id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>";
			CrestronMobile.sendData(data);
		}
*/
	},
	onDigitalChanged : function(join, value) {
		if(CrestronMobile.initialized === true) {
			var id = join.substring(1);
			value = (value === "1") ? "true" : "false";
			var data = "<cresnet><data><bool id=\"" + id + "\" value=\"" + value + "\" repeating=\"true\"/></data></cresnet>";
			CrestronMobile.sendData(data);
		}
	},
	sendHeartBeat : function() {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: send heartbeat updateComplete="+CrestronMobile.updateComplete); }
		if(CrestronMobile.updateComplete === true) {
			if ((Date.now() - CrestronMobile.lastDataReceived) > 5000) {
				if (CrestronMobile.debug) { CF.log("CrestronMobile: no response from Crestron for more than 5 seconds, resetting the connection"); }
				CrestronMobile.connection("reset");
			} else {
				CrestronMobile.sendData("<cresnet><control><comm><heartbeatRequest></heartbeatRequest></comm></control></cresnet>");
			}
		}
	},
	setLoadingMessageVisible : function(show) {
		CrestronMobile.loadingMessageVisible = show;
		CF.setJoin(CrestronMobile.loadingMessageSubpage, show);
	},
	connection : function(type) {
		if (CrestronMobile.debug) { CF.log("CrestronMobile: connection "+type); }
		if(type === "reset") {
			CrestronMobile.setLoadingMessageVisible(false);
			CrestronMobile.updateComplete = false;
			CF.setSystemProperties("CrestronMobile", { enabled : false });
			setTimeout(function() {
				CF.setSystemProperties("CrestronMobile", { enabled : true });
				CrestronMobile.setLoadingMessageVisible(true);
			}, 500);
		} else if(type === "disconnect") {
			CrestronMobile.setLoadingMessageVisible(false);
			CrestronMobile.updateComplete = false;
			CF.setSystemProperties("CrestronMobile", { enabled : false });
		} else if(type === "connect") {
			CF.setSystemProperties("CrestronMobile", { enabled : true });
		}
	},
	parseXML : function(xml) {
		if(!CrestronMobile.initialized && (xml.indexOf("string") >= 0 && xml.indexOf("value=\"\"") >= 0)) {
			return;
		}
		var parser = new DOMParser();
		xml = xml.substring(xml.indexOf("<?xml"));
		var tree = parser.parseFromString(xml, "text/xml");
		//Moved parser back to Parse function.  Possible memory leak causing crash when defined globally.
		//Also trying to clear the parser when I'm done with it so it doesn't stay resident.
		parser = undefined;
		if (tree === null) {
			return;
		}

		var updates = [];
		var index, update, valueNode, tempValue;
		var child, data, childTag, isUTF8;
		var dataElements = tree.getElementsByTagName("data");

		for (var i=0; i < dataElements.length; i++) {
			data = dataElements[i];
			child = data.firstElementChild;
			isUTF8 = (data.getAttribute("enc") === "UTF-8");
			while (child !== null) {
				childTag = child.tagName;
				if (childTag === "bool") {
					//Found Digital(bool) Element
					index = child.getAttributeNode("id").nodeValue;
					update = {
						join: "d" + index,
						value: (child.getAttributeNode("value").nodeValue === "true") ? 1 : 0
					};
					updates.push(update);
					CrestronMobile.dJoin[index - 1] = update;
				} else if (childTag === "string") {
					//Found Serial(string) Element
					index = child.getAttributeNode("id").nodeValue;
					tempValue = child.getAttribute("value");
					valueNode = child.getAttributeNode("value");
					if (tempValue === null) {
						if (child.firstChild !== null) {
							tempValue = child.firstChild.nodeValue;
						} else {
							tempValue = "";
						}
					}
					update = {
						join: "s" + index,
						value: isUTF8 ? decodeURIComponent(escape(tempValue)) : tempValue
					};
					updates.push(update);
					CrestronMobile.sJoin[index - 1] = update;

				} else if (childTag === "i32") {
					//Found Analog(i32) Element
					index = child.getAttributeNode("id").nodeValue;
					valueNode = child.getAttributeNode("value");
					if (valueNode === null) {
						valueNode = elem.firstChild;
					}
					update = {
						join : "a" + index,
						value : valueNode.value
					};
					updates.push(update);
					CrestronMobile.aJoin[index - 1] = update;
				}
				child = child.nextSibling;
			}
		}
		//Update Interface
		if(CrestronMobile.initialized && updates.length > 0) {
			CF.setJoins(updates, false);
		}
	},
	processFeedback : function(feedbackname, matchedstring) {
		CrestronMobile.lastDataReceived = Date.now();
		if(matchedstring.indexOf("<programReady><status>") >= 0) {
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got program ready status "+matchedstring); }
			if(CrestronMobile.connectionTimer > 0) {
				clearTimeout(CrestronMobile.connectionTimer);
			}
			//Found Program Ready Message, send Connect Request to system
			CrestronMobile.setLoadingMessageVisible(true);
			CrestronMobile.updateComplete = false;
			CrestronMobile.initialized = false;
			CrestronMobile.loggedIn = false;
			CrestronMobile.resetRunningJoins();

			CrestronMobile.connectionTimer = setTimeout(function() {
				if(CrestronMobile.updateComplete === false) {
					CrestronMobile.connection("reset");
				}
			}, 10000);
			CF.send("CrestronMobile", "<cresnet><control><comm><connectRequest><passcode>" + CrestronMobile.password + "</passcode><mode isUnicodeSupported=\"true\"></mode></connectRequest></comm></control></cresnet>");
		} else if(matchedstring.indexOf("<connectResponse>") >= 0) {
			//Found Connect Response Message, validate response
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got connect response "+matchedstring); }
			if (matchedstring.indexOf("<code>0</code>") > 0) {
				//Connection is good, send Update Request Message to system
				CrestronMobile.loggedIn = true;
				CF.send("CrestronMobile", "<cresnet><data><updateRequest></updateRequest></data></cresnet>");
			} else {
				CrestronMobile.connection("reset");
			}
		} else if(matchedstring.indexOf("endOfUpdate") >= 0) {
			//Update Finished, begin sending Heartbeat Message
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got endOfUpdate "+matchedstring); }
			CrestronMobile.setLoadingMessageVisible(false);

			CF.setJoins(CrestronMobile.dJoin, true);
			CF.setJoins(CrestronMobile.aJoin, true);
			CF.setJoins(CrestronMobile.sJoin, true);

			CrestronMobile.updateComplete = true;
			CrestronMobile.initialized = true;
			CrestronMobile.sendData("<cresnet><data><i32 id=\"17259\" value=\"" + CrestronMobile.orientation + "\"/></data></cresnet>");
		} else if(matchedstring.indexOf("</heartbeatResponse>") >= 0) {
			//Found Hearbeat Response Message
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got heartbeat response "+matchedstring); }
			if(CrestronMobile.loadingMessageVisible) {
				CrestronMobile.setLoadingMessageVisible(false);
			}
			CrestronMobile.updateComplete = true;
			CrestronMobile.initialized = true;
		} else if(matchedstring.indexOf("<heartbeatRequest>") >= 0) {
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got heartbeat request "+matchedstring); }
			CrestronMobile.setLoadingMessageVisible(false);
			CrestronMobile.updateComplete = true;
			CrestronMobile.initialized = true;
		} else if(matchedstring.indexOf("<string") >= 0 || matchedstring.indexOf("<bool") >= 0 || matchedstring.indexOf("<i32") >= 0) {
			//Parse the updated values
			if (CrestronMobile.debug) { CF.log("CrestronMobile: got update "+matchedstring); }
			CrestronMobile.parseXML(matchedstring);
		} else if(matchedstring.indexOf("<disconnectRequest>") >= 0) {
			CrestronMobile.setLoadingMessageVisible(true);
			CrestronMobile.updateComplete = false;
			CrestronMobile.initialized = false;
			CrestronMobile.loggedIn = false;
		}
	}
};

CF.modules.push({
	name : "CrestronMobile",
	setup : CrestronMobile.setup
});
