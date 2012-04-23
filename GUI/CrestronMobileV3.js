/* Crestron Mobile Interface
 //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

 AUTHORS:	Greg Soli, Audio Advice - Florent Pillet, CommandFusion
 CONTACT:	greg.soli@audioadvice.com
 VERSION:	v 3.0-alpha

 /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 */

var CrestronMobile = {
	// Possible states (constants) of a CrestronMobile instance
	NOT_INITIALIZED: 0,
	CONNECTING: 1,
	CONNECTED: 2,
	RESETTING: 3,
	DISCONNECTED: 4,

	// Global Variable Assignments
	debug: true,			// set to true to add CrestronMobile's own debugging messages to the log
	preloadComplete: false,
	instances: [],			// an array holding one module instance for each remote Crestron system

	//
	// Module setup function
	//
	setup:function () {
		if (CrestronMobile.debug) {
			CF.log("CrestronMobile: setup()");
		}

		// Setup unique ports if CrestronUUID was included
		try {
			CrestronUUID.setup();
		} catch (ex) {
		}

		// Global watch to enable all CrestronMobile instances when GUI preloading is complete
		CF.watch(CF.PreloadingCompleteEvent, this.onGUIPreloadComplete);

		CF.getJoin(CF.GlobalTokensJoin, function (j, v, tokens) {
			// Create a new instance (for now only one system)
			var instance = CrestronMobile.createInstance("CrestronMobile", tokens);
			CrestronMobile.instances.push(instance);
		});
	},

	onGUIPreloadComplete:function () {
		if (CrestronMobile.debug) {
			CF.log("CrestronMobile: GUI preload complete");
		}
		CrestronMobile.instances.forEach(function(instance) { instance.connection("connect"); });
	},

	/**
	* Create and return a new module instance
	* @param system		the name of the extern system to connect to, as defined in the GUI
	* @param globalTokens	the GUI's global tokens from which we extract various parameters
	*/
	createInstance: function(system, globalTokens) {
		/*
		* Properties of one CrestronMobile instance
		*/
		var instance = {
			state: CrestronMobile.NOT_INITIALIZED,
			initialized:false,
			hasNetwork:false,
			systemName:system,
			systemConnected:false,
			aJoinMax:0,
			dJoinMax:0,
			sJoinMax:0,
			gJoinMin:0,
			gJoinMax:0,
			password:"1234",

			heartbeatTimer:0,
			heartbeatCount:0,
			guiSuspended:false,
			lastDataReceived:0,

			updateComplete:false,

			digitalJoinRepeat:[],
			analogJoinValue:[],

			aJoin:[],
			dJoin:[],
			sJoin:[],

			loggedIn:false,
			orientation:"2",
			connectionResetTimeout:0,
			loadingMessageVisible:false,
			loadingMessageSubpage:"d4001",

			initialize: function(globalTokens) {
				// Setup base variables
				this.aJoinMax = parseInt(globalTokens["[aJoinMax]"], 10) || 200;
				this.sJoinMax = parseInt(globalTokens["[sJoinMax]"], 10) || 200;
				this.dJoinMax = parseInt(globalTokens["[dJoinMax]"], 10) || 1000;
				this.gJoinMin = parseInt(globalTokens["[gJoinMin]"], 10) || 1001;
				this.gJoinMax = parseInt(globalTokens["[gJoinMax]"], 10) || 1050;
				this.password = globalTokens["[cmPassword]"] || "1234";

				var i, j, n, digitalJoins = [], analogJoins = [], serialJoins = [], gestureJoins = [];
				for (i = 1, n = this.dJoinMax; i <= n; i++) {
					j = "d" + i;
					digitalJoins.push(j);
					this.dJoin.push({ join:j, value:0 });
				}
				for (i = 1, n = this.aJoinMax; i <= n; i++) {
					j = "a" + i;
					analogJoins.push(j);
					this.aJoin.push({ join:j, value:0 });
				}
				for (i = 1, n = this.sJoinMax; i <= n; i++) {
					j = "s" + i;
					serialJoins.push(j);
					this.sJoin.push({ join:j, value:"" });
				}
				for (i = this.gJoinMin, n = this.gJoinMax; i <= n; i++) {
					gestureJoins.push("d" + i);
				}

				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: dJoinMax=" + this.dJoinMax + ", aJoinMax=" + this.aJoinMax + ", sJoinMax=" + this.sJoinMax);
				}

				// Disable system if preloading is not complete yet
				if (!CrestronMobile.preloadComplete) {
					this.connection("disconnect");
				}

				// Watch events. For each event, we define a lamba function whose sole purpose is to call
				// into the instance's callback, ensuring that `this' is properly set when the callback executes
				var self = this;
				CF.watch(CF.NetworkStatusChangeEvent, function(networkStatus) { self.onNetworkStatusChange(networkStatus); }, true);
				CF.watch(CF.ConnectionStatusChangeEvent, self.systemName, function(system,connected,remote) { self.onSystemConnectionChanged(system,connected,remote); });
				CF.watch(CF.FeedbackMatchedEvent, self.systemName, "Feedback", function(feedback,match) { self.processFeedback(feedback,match); });

				CF.watch(CF.ObjectPressedEvent, digitalJoins, function(j,v,t) { self.onButtonPressed(j,v,t); });
				CF.watch(CF.ObjectReleasedEvent, digitalJoins, function(j,v,t) { self.onButtonReleased(j,v,t); });
				CF.watch(CF.ObjectDraggedEvent, analogJoins, function(j,v,t) { self.onAnalogChanged(j,v,t); });

				CF.watch(CF.JoinChangeEvent, serialJoins, function(j,v,t) { self.onSerialChanged(j,v,t); });
				CF.watch(CF.JoinChangeEvent, gestureJoins, function(j,v,t) { self.onDigitalChanged(j,v,t); });

				CF.watch(CF.OrientationChangeEvent, function(page,orientation) { self.onOrientationChange(page,orientation); }, true);

				CF.watch(CF.GUISuspendedEvent, function() { self.onGUISuspended(); });
				CF.watch(CF.GUIResumedEvent, function() { self.onGUIResumed(); });

				// Setup heartneat timer
				this.heartbeatTimer = setInterval(function () {
					if (!self.guiSuspended) {
						if (self.updateComplete) {
							self.sendHeartBeat();
						} else if (self.hasNetwork && ++self.heartbeatCount > 5 && !self.loggedIn && self.connectionResetTimeout === 0) {
							if (CrestronMobile.debug) {
								CF.log("CrestronMobile: heartbeatTimer fired, not loggedIn, time to reset connection (heartbeatCount=" + self.heartbeatCount + ")");
							}
							self.heartbeatCount = 0;
							self.connection("reset");
						}
					}
				}, 2000);
			},

			resetRunningJoins: function() {
				// Reset the known values of joins
				var i, n;
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: resetting running joins");
				}
				for (i = 0, n = this.dJoin.length; i < n; i++) {
					this.dJoin[i] = {
						join:"d" + (i + 1),
						value:0
					};
				}
				for (i = 0, n = this.aJoin.length; i < n; i++) {
					this.aJoin[i] = {
						join:"a" + (i + 1),
						value:0
					};
				}
				for (i = 0, n = this.sJoin.length; i < n; i++) {
					this.sJoin[i] = {
						join:"s" + (i + 1),
						value:""
					};
				}
			},

			setLoadingMessageVisible:function (show) {
				if (this.loadingMessageVisible !== show) {
					this.loadingMessageVisible = show;
					CF.setJoin(this.loadingMessageSubpage, show);
				}
			},

			// ------------------------------------------------------------------
			// Network events, data and connection handling
			// ------------------------------------------------------------------
			onNetworkStatusChange:function (networkStatus) {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: networkStatus hasNetwork=" + networkStatus.hasNetwork);
				}
				this.hasNetwork = networkStatus.hasNetwork;
				if (networkStatus.hasNetwork) {
					if (CrestronMobile.preloadComplete) {
						this.connection("connect");
					}
				} else {
					this.connection("disconnect");
				}
			},

			onSystemConnectionChanged: function(system, connected, remote) {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: system connected=" + connected + ", remote=" + remote);
				}
				this.systemConnected = connected;
				if (connected) {
					// reset heartbeatCount to give enough time for initial exchange
					this.heartbeatCount = 0;
				}
			},

			sendData:function (data) {
				CF.send(this.systemName, data, CF.UTF8);
			},

			clearConnectionResetTimeout: function() {
				if (this.connectionResetTimeout !== 0) {
					clearTimeout(this.connectionResetTimeout);
					this.connectionResetTimeout = 0;
				}
			},

			connection:function (type) {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: connection " + type);
				}

				if (type === "reset") {
					// Reset the connection: disconnect immediately then reconnect a bit later
					if (this.state !== CrestronMobile.RESETTING) {
						this.clearConnectionResetTimeout();
						this.state = CrestronMobile.RESETTING;
						this.heartbeatCount = 0;
						this.updateComplete = false;
						this.loggedIn = false;

						CF.setSystemProperties(this.systemName, { enabled:false });

						var self = this;
						this.connectionResetTimeout = setTimeout(function () {
							if (CrestronMobile.debug) {
								CF.log("CrestronMobile: connectionResetTimeout expired, re-enabling system");
							}
							self.connectionResetTimeout = 0;
							self.heartbeatCount = 0;			// prevent timer from reseting us again too early
							CF.setSystemProperties(self.systemName, { enabled:true });
							self.state = CrestronMobile.CONNECTING;
							self.setLoadingMessageVisible(true);
						}, 500);
					}

				} else if (type === "disconnect") {
					this.clearConnectionResetTimeout();
					this.heartbeatCount = 0;
					this.setLoadingMessageVisible(false);
					this.updateComplete = false;
					this.loggedIn = false;

					CF.setSystemProperties(this.systemName, { enabled:false });

					this.state = CrestronMobile.DISCONNECTED;

				} else if (type === "connect") {
					// this won't have any impact if system is not already connecting
					CF.setSystemProperties(this.systemName, { enabled:true });
					if (this.state === CrestronMobile.NOT_INITIALIZED || this.state === CrestronMobile.DISCONNECTED) {
						this.state = CrestronMobile.CONNECTING;
					}
				}
			},

			// ------------------------------------------------------------------
			// GUI events handling
			// ------------------------------------------------------------------
			onGUISuspended:function () {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: GUI suspended");
				}
				this.guiSuspended = true;
				this.heartbeatCount = 0;
			},

			onGUIResumed:function () {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: GUI resumed");
				}
				this.guiSuspended = false;
				this.heartbeatCount = 0;
				this.clearConnectionResetTimeout();
			},

			onOrientationChange:function (pageName, newOrientation) {
				if (CrestronMobile.debug) {
					CF.log("CrestronMobile: orientation changed, pageName=" + pageName + ", newOrientation=" + newOrientation);
				}
				if (newOrientation === CF.LandscapeOrientation) {
					this.sendData("<cresnet><data><i32 id=\"17259\" value=\"2\"/></data></cresnet>");
					this.orientation = "2";
				} else {
					this.sendData("<cresnet><data><i32 id=\"17259\" value=\"1\"/></data></cresnet>");
					this.orientation = "1";
				}
			},

			onButtonPressed:function (join, value, tokens) {
				var id = join.substring(1);
				var data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
				this.sendData(data);
				if (this.digitalJoinRepeat[id] !== undefined) {
					clearInterval(this.digitalJoinRepeat[id]);
				}
				var self = this;
				this.digitalJoinRepeat[id] = setInterval(function () {
					self.sendData(data);
				}, 500);
			},

			onButtonReleased:function (join, value, tokens) {
				var id = join.substring(1);
				clearInterval(this.digitalJoinRepeat[id]);
				this.digitalJoinRepeat[id] = undefined;
				this.sendData("<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>");
			},

			onAnalogChanged:function (join, value) {
				if (this.initialized) {
					this.sendData("<cresnet><data><i32 id=\"" + join.substring(1) + "\" value=\"" + value + "\"/></data></cresnet>");
				}
			},

			onSerialChanged:function (join, value) {
				//Not Currently Supported By Crestron
				/*
				var data;
				var id;
				if (this.initialized === true) {
				id = join.substring(1);

				data = "<cresnet><data  som=\"true\" eom=\"true\"><string id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>";
				this.sendData(data);
				}
				*/
			},

			onDigitalChanged:function (join, value) {
				if (this.initialized) {
					value = (value === "1") ? "true" : "false";
					this.sendData("<cresnet><data><bool id=\"" + join.substring(1) + "\" value=\"" + value + "\" repeating=\"true\"/></data></cresnet>");
				}
			},

			// ------------------------------------------------------------------
			// Heartbeat management
			// ------------------------------------------------------------------
			sendHeartBeat:function () {
				if (this.updateComplete) {
					if (this.heartbeatCount++ > 2) {
						// After a few seconds without any answer, reset the connection only if another reset
						// is not already in progress
						if (this.connectionResetTimeout === 0) {
							if (CrestronMobile.debug) {
								CF.log("CrestronMobile: no response from Crestron for more than 5 seconds, resetting the connection");
							}
							this.heartbeatCount = 0;
							this.connection("reset");
						}
					} else {
						// Send heartbeat message to Crestron
						this.sendData("<cresnet><control><comm><heartbeatRequest></heartbeatRequest></comm></control></cresnet>");
					}
				}
			},

			// ------------------------------------------------------------------
			// Crestron messages processing
			// ------------------------------------------------------------------
			parseXML:function (xml) {
				if (!this.initialized && (xml.indexOf("string") >= 0 && xml.indexOf("value=\"\"") >= 0)) {
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

				for (var i = 0; i < dataElements.length; i++) {
					data = dataElements[i];
					child = data.firstElementChild;
					isUTF8 = (data.getAttribute("enc") === "UTF-8");
					while (child !== null) {
						childTag = child.tagName;
						if (childTag === "bool") {
							//Found Digital(bool) Element
							index = child.getAttributeNode("id").nodeValue;
							update = {
								join:"d" + index,
								value:(child.getAttributeNode("value").nodeValue === "true") ? 1 : 0
							};
							updates.push(update);
							this.dJoin[index - 1] = update;
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
								join:"s" + index,
								value:isUTF8 ? decodeURIComponent(escape(tempValue)) : tempValue
							};
							updates.push(update);
							this.sJoin[index - 1] = update;

						} else if (childTag === "i32") {
							//Found Analog(i32) Element
							index = child.getAttributeNode("id").nodeValue;
							valueNode = child.getAttributeNode("value");
							if (valueNode === null) {
								valueNode = elem.firstChild;
							}
							update = {
								join:"a" + index,
								value:valueNode.value
							};
							updates.push(update);
							this.aJoin[index - 1] = update;
						}
						child = child.nextSibling;
					}
				}
				//Update Interface
				if (this.initialized && updates.length > 0) {
					CF.setJoins(updates, true);
				}
			},
			processFeedback:function (feedbackname, matchedstring) {
				this.heartbeatCount = 0;
				this.lastDataReceived = Date.now();
				if (matchedstring.indexOf("<programReady><status>") >= 0) {
					if (CrestronMobile.debug) {
						CF.log("CrestronMobile: got program ready status " + matchedstring);
					}
					//Found Program Ready Message, send Connect Request to system
					this.clearConnectionResetTimeout();
					this.setLoadingMessageVisible(true);
					this.updateComplete = false;
					this.initialized = false;
					this.loggedIn = false;
					this.heartbeatCount = 0;		// reset heartbeatCount: this gives us 10s to log in
					this.resetRunningJoins();

					CF.send(this.systemName, "<cresnet><control><comm><connectRequest><passcode>" + this.password + "</passcode><mode isUnicodeSupported=\"true\"></mode></connectRequest></comm></control></cresnet>");

				} else if (matchedstring.indexOf("<connectResponse>") >= 0) {
					//Found Connect Response Message, validate response
					if (CrestronMobile.debug) {
						CF.log("CrestronMobile: got connect response " + matchedstring);
					}
					if (matchedstring.indexOf("<code>0</code>") > 0) {
						//Connection is good, send Update Request Message to system
						this.loggedIn = true;
						CF.send(this.systemName, "<cresnet><data><updateRequest></updateRequest></data></cresnet>");
					} else {
						this.connection("reset");
					}
				} else if (matchedstring.indexOf("endOfUpdate") >= 0) {
					//Update Finished, begin sending Heartbeat Message
					if (CrestronMobile.debug) {
						CF.log("CrestronMobile: got endOfUpdate " + matchedstring);
					}
					this.setLoadingMessageVisible(false);

					CF.setJoins(this.dJoin, true);
					CF.setJoins(this.aJoin, true);
					CF.setJoins(this.sJoin, true);

					this.updateComplete = true;
					this.initialized = true;
					this.sendData("<cresnet><data><i32 id=\"17259\" value=\"" + this.orientation + "\"/></data></cresnet>");
				} else if (matchedstring.indexOf("</heartbeatResponse>") >= 0) {
					//Found Hearbeat Response Message
					this.setLoadingMessageVisible(false);
					this.updateComplete = true;
					this.initialized = true;
				} else if (matchedstring.indexOf("<heartbeatRequest>") >= 0) {
					if (CrestronMobile.debug) {
						CF.log("CrestronMobile: got heartbeat request " + matchedstring);
					}
					this.setLoadingMessageVisible(false);
					this.updateComplete = true;
					this.initialized = true;
				} else if (matchedstring.indexOf("<string") >= 0 || matchedstring.indexOf("<bool") >= 0 || matchedstring.indexOf("<i32") >= 0) {
					//Parse the updated values
					if (CrestronMobile.debug) {
						CF.log("CrestronMobile: got update " + matchedstring);
					}
					this.parseXML(matchedstring);
				} else if (matchedstring.indexOf("<disconnectRequest>") >= 0) {
					this.setLoadingMessageVisible(true);
					this.updateComplete = false;
					this.initialized = false;
					this.loggedIn = false;
				}
			}
		};

		instance.initialize(globalTokens);
		return instance;
	}
};

CF.modules.push({
	name:"CrestronMobile",			// the name of this module
	setup:CrestronMobile.setup,		// the setup function to call before CF.userMain
	object:CrestronMobile,			// the `this' object for the setup function
	version:"v3.0-alpha"			// the version of this module
});
