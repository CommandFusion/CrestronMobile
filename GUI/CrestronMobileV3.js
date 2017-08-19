/* Crestron Mobile Interface
 //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

 AUTHORS:	Greg Soli - Audio Advice, Florent Pillet - CommandFusion, Jarrod Bell - CommandFusion
 CONTACT:	support@commandfusion.com
 VERSION:	v 3.5 - May 25, 2016

 /////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
 */

var CrestronMobile = {
	// Possible states (constants) of a CrestronMobile instance
	NOT_INITIALIZED: 0,
	CONNECTING: 1,
	CONNECTED: 2,
	RESETTING: 3,
	DISCONNECTED: 4,

	// list of truthy values that we can receive from XML
	truth: {
		"true": 1,
		"True": 1,
		"TRUE": 1,
		"1": 1
	},

	// Global Variable Assignments
	debug: false,				// set to true to add CrestronMobile's own debugging messages to the log
	debugListJoin: null,		// join to output logs to a list when not connected to remote debugger (i.e. "l1") - this is for debugging purposes only
	debugListTextJoin: null,	// string join in the content subpage of the debug list (i.e. "s1") - this is for debugging purposes only
	preloadComplete: false,
	instances: [],				// an array holding one module instance for each remote Crestron system

	//
	// Logging helper
	//
	log: function(msg) {
		if (CF.debug) {
			CF.log(msg);
		} else if (this.debugListJoin != null) {
			var d=new Date(), o={};
			o[this.debugListTextJoin] = ("0"+d.getHours()).substr(-2)+":"+("0"+d.getMinutes()).substr(-2)+":"+("0"+d.getSeconds()).substr(-2)+"."+("00"+d.getMilliseconds()).substr(-2)+"> "+msg;
			CF.listAdd(this.debugListJoin, [o]);
		}
	},

	//
	// Module setup function
	//
	setup: function () {
		if (CrestronMobile.debug) {
			// turn off CrestronMobile logging if Remote Debugger is not connected
			if (CF.debug || CrestronMobile.debugListJoin) {
				CrestronMobile.log("setting up");
			} else {
				CrestronMobile.debug = false;
			}
		}

		// Replace CF.userMain() with a function that will execute only after the user's CF.userMain()
		// function has run
		var oldUserMain = CF.userMain;
		CF.userMain = function() {
			if (oldUserMain != null) {
				if (CrestronMobile.debug)
					CrestronMobile.log("Startup: executing previously defined CF.userMain()")
				oldUserMain.apply(CF, []);
			}
			if (CrestronMobile.debug)
				CrestronMobile.log("Startup: setting up instances for connection");
			CrestronMobile.preloadComplete = true;
			CrestronMobile.instances.forEach(function(instance) { instance.connection("connect"); });
		}

		// Detect autoconfiguration. Skip system with empty name (main control system)
		var autoconfigFound = false, associatedSystems = {};
		var additionalExcludedJoins = ["d0","s0","a0"];		// ignore zero joins by default
		if (CrestronMobile.debugListJoin != null)
			additionalExcludedJoins.push(CrestronMobile.debugListJoin);
		if (CrestronMobile.debugListTextJoin != null)
			additionalExcludedJoins.push(CrestronMobile.debugListTextJoin);
		for (var systemName in CF.systems) {
			if (CF.systems.hasOwnProperty(systemName)) {
				// We want to automatically exclude the connection and disconnection joins for all systems
				// from CrestronMobile access
				var sys = CF.systems[systemName];
				if (sys.connect.length) {
					additionalExcludedJoins.push(sys.connect);
				}
				if (sys.disconnect.length) {
					additionalExcludedJoins.push(sys.disconnect);
				}

				// If system is of type TCP, detect an autoconfiguration object
				if (systemName !== "" && CF.systems[systemName].type === "tcp") {
					var autoconfigName = "CrestronMobileConfig_" + systemName;
					if (window[autoconfigName] !== undefined) {
						autoconfigFound = true;
						associatedSystems[systemName] = window[autoconfigName];
						// Setup unique ports if required in the config script
						if (associatedSystems[systemName]["setup"] != null)
							associatedSystems[systemName].setup(systemName);
					}
				}
			}
		}

		// First get the global tokens, then the GUI description, then we can start
		// creating instances and link them to the watched joins
		CF.getJoin(CF.GlobalTokensJoin, function (j, v, globalTokens) {
			// No configured mode, fallback on Compatibility mode
			if (!autoconfigFound) {
				var cmSystem = globalTokens["[CrestronMobile]"] || "CrestronMobile";
				if (CF.systems[cmSystem] !== undefined && CF.systems[cmSystem].type === "tcp") {
					// No auto-configuration found: use old-style compatibility, generate a fake
					// autoconfig that uses the "CrestronMobile" system and monitors all the pages
					associatedSystems[cmSystem] = {
						pages: [".*"],
						joins: [],
						password: globalTokens["[cmPassword]"] || "1234",
						dJoinMax: globalTokens["[dJoinMax]"] || 3999,
						aJoinMax: globalTokens["[aJoinMax]"] || 3999,
						sJoinMax: globalTokens["[sJoinMax]"] || 3999
					};
					if (CrestronMobile.debug) {
						CrestronMobile.log("falling back on compatibility mode, will use system " + cmSystem + " with password " + associatedSystems[cmSystem].password);
					}
				}
			}

			// Obtain the GUI description and perform instantiation of each CrestronMobile instance in the callback
			CF.getGuiDescription(function(guiDescription) {
				for (var sys in associatedSystems) {
					if (associatedSystems.hasOwnProperty(sys)) {
						// Create a new instance
						var instance = CrestronMobile.createInstance(sys, associatedSystems[sys], guiDescription, additionalExcludedJoins);
						if (CrestronMobile.debug)
							CrestronMobile.log("Adding new instance to CrestronMobile instances, using system " + sys);
						CrestronMobile.instances.push(instance);
					}
				}
			});
		});
	},

	/**
	* Create and return a new module instance
	* @param name		the name of the extern system to connect to, as defined in the GUI
	* @param config		the configuration object we use to setup watches
	* @param guiDescription the result of CF.getGuiDescription()
	*/
	createInstance: function(name, config, guiDescription, additionalExcludedJoins) {

		var instance = {
			systemName: name,
			systemConnected: false,
			password: config.password,

			state: CrestronMobile.NOT_INITIALIZED,
			loggedIn: false,
			updateComplete: false,
			initialized: false,
			hasNetwork: false,
			guiSuspended: false,
			orientation:"2",

			heartbeatTimer: 0,
			heartbeatCount: 0,
			lastDataReceived: 0,

			connectionResetTimeout:0,

			loadingMessageVisible: false,
			loadingMessageSubpage: "d4001",

			dJoinMax: config.dJoinMax || 3999,				// the highest digital join number that will be processed by CrestronMobile
			aJoinMax: config.aJoinMax || 3999,				// the highest analog join number that will be processed by CrestronMobile
			sJoinMax: config.sJoinMax || 3999,				// the highest serial join number that will be processed by CrestronMobile

			aJoin: {},
			dJoin: {},
			sJoin: {},
			buttonRepeat: {},
			sliderPress: {},
			sliderPressJoin: {},

			// Take a list of GUI objects (and a list of joins to exclude) and add all
			// the joins from the list to the monitored join for this processor
			monitorGuiObjects: function(objs, subpages, excludedJoins) {
				if (objs == null) return;
				var i, n, guiObj, join, type, excluded, sp, excludedList = [];
				for (i = 0, n = objs.length; i < n; i++) {
					guiObj = objs[i];
					join = guiObj.join;
					excluded = (excludedJoins.indexOf(join) !== -1);
					if (guiObj.type === "Button") {
					 	if (parseInt(join.substr(1), 10) > this.dJoinMax) {
							excluded = true;
							if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						}
						if (!excluded) {
							this.dJoin[join] = 0;
							this.buttonRepeat[join] = 0;
						}
						join = guiObj.activeTextJoin;
						if (join.length && excludedJoins.indexOf(join) === -1) {
							if (parseInt(join.substr(1), 10) <= this.sJoinMax) {
								this.sJoin[join] = "";
							} else if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						}
						join = guiObj.inactiveTextJoin;
						if (join.length && join != guiObj.activeTextJoin && excludedJoins.indexOf(join) === -1) {
							if (parseInt(join.substr(1), 10) <= this.sJoinMax) {
								this.sJoin[join] = "";
							} else if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						}
					} else if (guiObj.type === "Slider") {
						if (parseInt(join.substr(1), 10) > this.aJoinMax) {
							excluded = true;
							if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						}
						if (!excluded) {
							this.aJoin[join] = 0;
						}
						var pressJoin = guiObj.pressedJoin;
						if (pressJoin.length && excludedJoins.indexOf(pressJoin) === -1) {
							if (parseInt(pressJoin.substr(1), 10) <= this.dJoinMax) {
								this.dJoin[pressJoin] = 0;
								this.sliderPress[pressJoin] = 0;
								this.sliderPressJoin[join] = pressJoin;		// Map the sliders analog join with the digital join
							} else if (CrestronMobile.debug) {
								excludedList.push(pressJoin);
							}
						}
					} else if (guiObj.type === "SubpageRef") {
						if (parseInt(join.substr(1), 10) > this.dJoinMax) {
							excluded = true;
							if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						}
						if (!excluded) {
							this.dJoin[join] = 0;
						}
						sp = subpages[guiObj.subpage];
						if (sp != null) {
							delete subpages[guiObj.subpage];
							this.monitorGuiObjects(sp.objects, subpages, excludedJoins);
						}
					} else if (guiObj.type === "List") {
						if (guiObj.header.length) {
							sp = subpages[guiObj.header];
							if (sp != null) {
								delete subpages[guiObj.header];
								this.monitorGuiObjects(sp.objects, subpages, excludedJoins);
							}
						}
						if (guiObj.footer.length) {
							sp = subpages[guiObj.footer];
							if (sp != null) {
								delete subpages[guiObj.footer];
								this.monitorGuiObjects(sp.objects, subpages, excludedJoins);
							}
						}
					} else if (!excluded) {
						type = join.charAt(0);
						if (this.hasOwnProperty(type + "JoinMax") && parseInt(join.substr(1), 10) > this[type + "JoinMax"]) {
							if (CrestronMobile.debug) {
								excludedList.push(join);
							}
						} else {
							if (type === 'd') {
								this.dJoin[join] = 0;
							} else if (type === 'a') {
								this.aJoin[join] = 0;
							} else if (type === 's') {
								this.sJoin[join] = "";
							}
						}
					}
				}
				if (CrestronMobile.debug && excludedList.length > 0) {
					CrestronMobile.log("CrestronMobile: Excluded joins " + excludedList.join(', '));
				}
			},

			initialize: function(config, guiDescription, additionalExcludedJoins) {
				var i, j, n, c;
				var guiPages = guiDescription.pages, numGuiPages = guiPages.length, page, subpages = {};
				var buttonJoins = [], analogJoins = [], serialJoins = [], digitalJoins = [], excludedJoins = [], sliderPressJoins = [];

				// create a named map of subpages (new in v3.1)
				guiDescription.subpages.forEach(function(subpage) { subpages[subpage.name] = subpage; });

				// get the optional list of excluded joins, otherwise we'll use an empty list
				if (config["excludedJoins"] !== undefined) {
					excludedJoins = config.excludedJoins;
				}
				excludedJoins = excludedJoins.concat(additionalExcludedJoins);

				// gather the complete set of joins to monitor
				var configPages = config["pages"] || [];
				if (!configPages.length) {
					configPages.push(".*");
				}
				for (i = 0, n = configPages.length; i < n; i++) {
					var regex = new RegExp(configPages[i]);
					for (j = 0; j < numGuiPages; j++) {
						page = guiPages[j];
						if (regex.test(page.name)) {
							// add all joins of this page
							if (page.join !== "d0") {
								this.dJoin[page.join] = 0;
							}
							this.monitorGuiObjects(page.portraitObjects, subpages, excludedJoins);
							this.monitorGuiObjects(page.landscapeObjects, subpages, excludedJoins);
						}
					}
				}

				// add optional joins defined in config.joins. Note that any buttons added here won't
				// be observed as repeating buttons, but simply as on/off digital joins
				if (config["additionalJoins"] !== undefined) {
					var array = config.additionalJoins;
					for (i = 0, n = array.length; i < n; i++) {
						j = array[i];
						c = j.charAt(0);
						if (c === 'd') {
							digitalJoins.push(j);
						} else if (c === 'a') {
							analogJoins.push(j);
						} else if (c === 's') {
							serialJoins.push(j);
						}
					}
				}
				var joins = this.dJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						if (this.buttonRepeat[j] !== undefined) {
							buttonJoins.push(j);
						} else {
							digitalJoins.push(j);
						}
					}
				}
				joins = this.aJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						analogJoins.push(j);
					}
				}
				joins = this.sJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						serialJoins.push(j);
					}
				}

				joins = this.sliderPressJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						sliderPressJoins.push(j);
					}
				}

				// we must first turn the system OFF
				this.connection("disconnect");

				// Watch events. For each event, we define a lamba function whose sole purpose is to call
				// into the instance's callback, ensuring that `this' is properly set when the callback executes
				var self = this;
				CF.watch(CF.NetworkStatusChangeEvent, function(networkStatus) { self.onNetworkStatusChange(networkStatus); }, true);
				CF.watch(CF.ConnectionStatusChangeEvent, self.systemName, function(system,connected,remote) { self.onSystemConnectionChanged(system,connected,remote); }, true);
				CF.watch(CF.FeedbackMatchedEvent, self.systemName, self.systemName+"Feedback", function(feedback,match) { self.processFeedback(feedback,match); });

				CF.watch(CF.ObjectPressedEvent, buttonJoins, function(j) { self.onButtonPressed(j); });
				CF.watch(CF.ObjectReleasedEvent, buttonJoins, function(j) { self.onButtonReleased(j); });
				CF.watch(CF.ObjectPressedEvent, sliderPressJoins, function(j) { self.onSliderPressed(j); });
				CF.watch(CF.ObjectReleasedEvent, sliderPressJoins, function(j) { self.onSliderReleased(j); });
				CF.watch(CF.ObjectDraggedEvent, analogJoins, function(j,v) { self.onAnalogChanged(j,v); });
				CF.watch(CF.JoinChangeEvent, serialJoins, function(j,v,t) { self.onSerialChanged(j,v,t); });
				CF.watch(CF.JoinChangeEvent, digitalJoins, function(j,v) { self.onDigitalChanged(j,v); });
				CF.watch(CF.JoinChangeEvent, analogJoins, function(j,v) { self.onAnalogChanged(j,v); });

				CF.watch(CF.OrientationChangeEvent, function(page,orientation) { self.onOrientationChange(page,orientation); }, true);

				CF.watch(CF.GUISuspendedEvent, function() { self.onGUISuspended(); });
				CF.watch(CF.GUIResumedEvent, function() { self.onGUIResumed(); });

				// Setup heartbeat timer
				this.setupHeartbeatTimer();

				if (CrestronMobile.preloadComplete)
					this.connection("connect");
			},

			resetRunningJoins: function() {
				// Reset the known values of joins
				if (CrestronMobile.debug) {
					CrestronMobile.log("resetting running joins");
				}
				var j, joins = this.dJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						joins[j] = 0;
					}
				}
				joins = this.aJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						joins[j] = 0;
					}
				}
				joins = this.sJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						joins[j] = "";
					}
				}
			},

			// ------------------------------------------------------------------
			// User interface support
			// ------------------------------------------------------------------
			setLoadingMessageVisible: function (show) {
				if (this.loadingMessageSubpage !== null && this.loadingMessageVisible !== show) {
					this.loadingMessageVisible = show;
					CF.setJoin(this.loadingMessageSubpage, show);
				}
			},

			// ------------------------------------------------------------------
			// Network events, data and connection handling
			// ------------------------------------------------------------------
			onNetworkStatusChange: function (networkStatus) {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": onNetworkStatusChange hasNetwork=" + networkStatus.hasNetwork);
				}
				if (this.hasNetwork != networkStatus.hasNetwork) {
					this.hasNetwork = networkStatus.hasNetwork;
					if (networkStatus.hasNetwork) {
						if (this.state == CrestronMobile.DISCONNECTED) {
							this.connection("connect");
						}
					} else {
						this.connection("disconnect");
					}
				}
			},

			onSystemConnectionChanged: function(system, connected, remote) {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": connected=" + connected + ", remote=" + remote + ", systemConnected="+this.systemConnected+", state="+this.state);
				}
				if (this.systemConnected != connected) {
					this.systemConnected = connected;
					this.heartbeatCount = 0;
					if (connected) {
						// reset heartbeatCount to give enough time for initial exchange
						this.clearConnectionResetTimeout();
					} else if (this.state == CrestronMobile.CONNECTING || this.state == CrestronMobile.CONNECTED) {
						this.state = CrestronMobile.CONNECTING;
						this.updateComplete = false;
						this.loggedIn = false;
						this.setLoadingMessageVisible(true);
					}
				}
			},

			sendData: function(data) {
				CF.send(this.systemName, data, CF.UTF8);
			},

			clearConnectionResetTimeout: function() {
				if (this.connectionResetTimeout !== 0) {
					clearTimeout(this.connectionResetTimeout);
					this.connectionResetTimeout = 0;
				}
			},

			connection: function (type) {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": connection(\"" + type + "\")");
				}

				if (type === "reset") {
					// Reset the connection: disconnect immediately then reconnect a bit later
					if (this.state !== CrestronMobile.RESETTING) {
						this.clearConnectionResetTimeout();
						this.state = CrestronMobile.RESETTING;
						this.heartbeatCount = 0;
						this.updateComplete = false;
						this.loggedIn = false;
						this.setLoadingMessageVisible(true);

						CF.setSystemProperties(this.systemName, { enabled:false });

						var self = this;
						this.connectionResetTimeout = setTimeout(function () {
							if (CrestronMobile.debug)
								CrestronMobile.log(self.systemName + ": connectionResetTimeout expired, re-enabling system");
							self.connectionResetTimeout = 0;
							self.heartbeatCount = 0;			// prevent timer from reseting us again too early
							CF.setSystemProperties(self.systemName, { enabled:true });
							self.state = CrestronMobile.CONNECTING;
						}, 100);
					}

				} else if (type === "disconnect") {
					this.clearConnectionResetTimeout();
					this.heartbeatCount = 0;
					this.updateComplete = false;
					this.loggedIn = false;
					this.state = CrestronMobile.DISCONNECTED;
					CF.setSystemProperties(this.systemName, { enabled:false });
					this.setLoadingMessageVisible(true);

				} else if (type === "connect") {
					// this won't have any impact if system is not already connecting
					if (this.state === CrestronMobile.NOT_INITIALIZED || this.state === CrestronMobile.DISCONNECTED) {
						CF.setSystemProperties(this.systemName, { enabled:true });
						this.setLoadingMessageVisible(true);
						this.state = CrestronMobile.CONNECTING;
					}
				}
			},

			// ------------------------------------------------------------------
			// GUI events handling
			// ------------------------------------------------------------------
			onGUISuspended: function () {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": GUI suspended");
				}
				this.guiSuspended = true;
				this.clearHeartbeatTimer();
				this.clearConnectionResetTimeout();
				this.heartbeatCount = 0;
			},

			onGUIResumed: function () {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": GUI resumed");
				}
				this.guiSuspended = false;
				this.heartbeatCount = 0;
				this.clearConnectionResetTimeout();
				this.setupHeartbeatTimer();
				if (this.state == CrestronMobile.RESETTING) {
					CF.setSystemProperties(this.systemName, { enabled:true });
					this.state = CrestronMobile.CONNECTING;
				}
			},

			onOrientationChange: function (pageName, newOrientation) {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": orientation changed, pageName=" + pageName + ", newOrientation=" + newOrientation);
				}
				if (this.initialized) {
					if (newOrientation === CF.LandscapeOrientation) {
						this.sendData("<cresnet><data><i32 id=\"17259\" value=\"2\"/></data></cresnet>");
						this.orientation = "2";
					} else {
						this.sendData("<cresnet><data><i32 id=\"17259\" value=\"1\"/></data></cresnet>");
						this.orientation = "1";
					}
				}
			},

			onButtonPressed: function(join) {
				if (this.initialized) {
					var id = join.substring(1);
					var data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
					this.sendData(data);
					var timer = this.buttonRepeat[id];
					if (timer !== 0) {
						clearInterval(timer);
						this.buttonRepeat[id] = 0;
					}
					var self = this;
					this.buttonRepeat[id] = setInterval(function () {
						if (self.initialized) {
							self.sendData(data);
						} else {
							clearInterval(self.buttonRepeat[id]);
							self.buttonRepeat[id] = 0;
						}
					}, 500);
				}
			},

			onButtonReleased: function(join) {
				if (this.initialized) {
					var id = join.substring(1);
					if (this.buttonRepeat[id] !== 0) {
						clearInterval(this.buttonRepeat[id]);
						this.buttonRepeat[id] = 0;
					}
					this.sendData("<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>");
				}
			},

			onSliderPressed: function(join) {
				if (this.initialized) {
					var digitalJoin = this.sliderPressJoin[join];
					var id = digitalJoin.substring(1);
					var data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
					this.sendData(data);
					var timer = this.sliderPress[id];
					if (timer !== 0) {
						clearInterval(timer);
						this.sliderPress[id] = 0;
					}
					var self = this;
					this.sliderPress[id] = setInterval(function () {
						if (self.initialized) {
							self.sendData(data);
						} else {
							clearInterval(self.sliderPress[id]);
							self.sliderPress[id] = 0;
						}
					}, 500);
				}
			},

			onSliderReleased: function(join) {
				if (this.initialized) {
					var digitalJoin = this.sliderPressJoin[join];
					var id = digitalJoin.substring(1);
					if (this.sliderPress[id] !== 0) {
						clearInterval(this.sliderPress[id]);
						this.sliderPress[id] = 0;
					}
					this.sendData("<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>");
				}
			},

			onAnalogChanged: function (join, value) {
				if (this.initialized) {
					// only transmit update if Crestron doesn't already know this value. In practice, iViewer only fires
					// join change events when the join value actually changes
					if (this.aJoin[join] !== value) {
						this.aJoin[join] = value;
						this.sendData("<cresnet><data><i32 id=\"" + join.substring(1) + "\" value=\"" + value + "\"/></data></cresnet>");
					}
				}
			},

			onSerialChanged: function (join, value) {
				if (this.initialized) {
					if (this.sJoin[join] !== value) {
						this.sJoin[join] = value;
						value = value.replace(/&/g, '&amp;')
							.replace(/</g, '&lt;')
							.replace(/>/g, '&gt;')
							.replace(/"/g, '&quot;');
						this.sendData("<cresnet><data  som=\"true\" eom=\"true\"><string id=\"" + join.substring(1) + "\" value=\"" + value + "\"/></data></cresnet>");
					}
				}
			},

			onDigitalChanged: function (join, value) {
				if (this.initialized) {
					if (value === 1 || value === "1") {
						if (this.dJoin[join] === 1) {
							return;
						}
						this.dJoin[join] = 1;
						value = "true";
					} else {
						if (this.dJoin[join] === 0) {
							return;
						}
						this.dJoin[join] = 0;
						value = "false";
					}
					this.sendData("<cresnet><data><bool id=\"" + join.substring(1) + "\" value=\"" + value + "\" repeating=\"true\"/></data></cresnet>");
				}
			},

			// ------------------------------------------------------------------
			// Heartbeat management
			// ------------------------------------------------------------------
			setupHeartbeatTimer: function() {
				var self = this;
				if (this.heartbeatTimer != 0)
					return;
				this.heartbeatTimer = setInterval(function () {
					if (!self.guiSuspended) {
						if (self.updateComplete) {
							self.sendHeartBeat();
						} else if (self.hasNetwork && ++self.heartbeatCount > 5 && !self.loggedIn && self.connectionResetTimeout === 0) {
							if (CrestronMobile.debug) {
								CrestronMobile.log("heartbeatTimer fired, not loggedIn, time to reset connection (heartbeatCount=" + self.heartbeatCount + ")");
							}
							self.connection("reset");
						}
					}
				}, 2000);
			},

			clearHeartbeatTimer: function() {
				if (this.heartbeatTimer != 0) {
					clearInterval(this.heartbeatTimer);
					this.heartbeatTimer = 0;
				}
			},

			sendHeartBeat: function () {
				if (this.updateComplete) {
					if (this.heartbeatCount++ > 2) {
						// After a few seconds without any answer, reset the connection only if another reset
						// is not already in progress
						if (this.connectionResetTimeout === 0) {
							if (CrestronMobile.debug) {
								CrestronMobile.log(this.systemName + ": no response from Crestron processor for more than 5 seconds, resetting the connection");
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
			parseXML: function (xml) {
				if (!this.initialized && (xml.indexOf("string") >= 0 && xml.indexOf("value=\"\"") >= 0)) {
					return;
				}
				var parser = new window.DOMParser();
				xml = xml.substring(xml.indexOf("<?xml"));
				var tree = parser.parseFromString(xml, "text/xml");
				// Moved parser back to Parse function.  Possible memory leak causing crash when defined globally.
				// Also trying to clear the parser when I'm done with it so it doesn't stay resident.
				parser = undefined;
				if (tree === null) {
					return;
				}

				var updates = [];
				var join, valueNode, tempValue;
				var child, data, childTag, isUTF8;
				var dataElements = tree.getElementsByTagName("data");

				for (var i = 0; i < dataElements.length; i++) {
					data = dataElements[i];
					child = data.firstElementChild;
					isUTF8 = true; //(data.getAttribute("enc") === "UTF-8");
					while (child !== null) {
						childTag = child.tagName;
						if (childTag === "bool") {
							// Found Digital(bool) Element
							join = "d" + child.getAttributeNode("id").nodeValue;
							tempValue = CrestronMobile.truth[child.getAttributeNode("value").nodeValue];
							if (tempValue === undefined) {
								tempValue = 0;
							}
							if (this.initialized) {
								updates.push({join:join, value:tempValue});
							}
							this.dJoin[join] = tempValue;

						} else if (childTag === "string") {
							// Found Serial(string) Element
							join = "s" + child.getAttributeNode("id").nodeValue;
							if (this.sJoin.hasOwnProperty(join)) {
								tempValue = child.getAttribute("value");
								if (tempValue === null) {
									if (child.firstChild !== null) {
										tempValue = child.firstChild.nodeValue;
									} else {
										tempValue = "";
									}
								}
								if (isUTF8) {
									tempValue = decodeURIComponent(encodeURIComponent(tempValue));
								}
								if (this.initialized) {
									updates.push({join:join, value:tempValue});
								}
								this.sJoin[join] = tempValue;
							}

						} else if (childTag === "i32") {
							// Found Analog(i32) Element
							join = "a" + child.getAttributeNode("id").nodeValue;
							valueNode = child.getAttributeNode("value");
							if (valueNode === null) {
								valueNode = child.firstChild;
							}
							tempValue = valueNode.nodeValue;
							if (this.initialized) {
								updates.push({join:join, value:tempValue});
							}
							this.aJoin[join] = tempValue;
						}
						child = child.nextSibling;
					}
				}
				// Update Interface
				if (updates.length > 0) {
					CF.setJoins(updates, true);
				}
			},

			gotProgramReadyStatus: function(str) {
				// This is the first message we should receive upon connecting to Crestron
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": got program ready status " + str);
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
			},

			gotConnectResponse: function(str) {
				//Found Connect Response Message, validate response
				if (CrestronMobile.debug) {
					CrestronMobile.log("got connect response " + str);
				}
				this.state = CrestronMobile.CONNECTED;
				if (str.indexOf("<code>0</code>") > 0) {
					//Connection is good, send Update Request Message to system
					this.loggedIn = true;
					CF.send(this.systemName, "<cresnet><data><updateRequest></updateRequest></data></cresnet>");
				} else {
					this.connection("reset");
				}
			},

			gotEndOfUpdate: function(str) {
				// Update complete, send all current known join status to iViewer
				// and begin sending Heartbeat Message
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": got endOfUpdate " + str);
				}
				this.setLoadingMessageVisible(false);

				var j, initial = [], joins = this.dJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						initial.push({join:j, value:joins[j]});
					}
				}
				joins = this.aJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						initial.push({join:j, value:joins[j]});
					}
				}
				joins = this.sJoin;
				for (j in joins) {
					if (joins.hasOwnProperty(j)) {
						initial.push({join:j, value:joins[j]});
					}
				}
				if (initial.length >= 0) {
					CF.setJoins(initial, true);
				}

				this.updateComplete = true;
				this.initialized = true;
				this.sendData("<cresnet><data><i32 id=\"17259\" value=\"" + this.orientation + "\"/></data></cresnet>");
			},

			gotHeartbeatResponse: function() {
				// Found Hearbeat Response Message
				this.setLoadingMessageVisible(false);
				this.updateComplete = true;
				this.initialized = true;
			},

			gotHeartbeatRequest: function(str) {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": got heartbeat request " + str);
				}
				this.setLoadingMessageVisible(false);
				this.updateComplete = true;
				this.initialized = true;
			},

			gotDisconnectRequest: function() {
				if (CrestronMobile.debug) {
					CrestronMobile.log(this.systemName + ": got disconnect request");
				}
				this.setLoadingMessageVisible(true);
				this.updateComplete = false;
				this.initialized = false;
				this.loggedIn = false;
			},

			processFeedback: function (feedbackname, str) {
				this.heartbeatCount = 0;
				this.lastDataReceived = Date.now();

				if (str.indexOf("<programReady><status>") >= 0) {
					this.gotProgramReadyStatus(str);
				} else if (str.indexOf("<connectResponse>") >= 0) {
					this.gotConnectResponse(str);
				} else if (str.indexOf("endOfUpdate") >= 0) {
					this.gotEndOfUpdate(str);
				} else if (str.indexOf("</heartbeatResponse>") >= 0) {
					this.gotHeartbeatResponse();
				} else if (str.indexOf("<heartbeatRequest>") >= 0) {
					this.gotHeartbeatRequest(str);
				} else if (str.indexOf("<string") >= 0 || str.indexOf("<bool") >= 0 || str.indexOf("<i32") >= 0) {
					//Parse the updated values
					if (CrestronMobile.debug && CF.debug) {
						CrestronMobile.log("CrestronMobile: got update " + str);
					}
					this.parseXML(str);
				} else if (str.indexOf("<disconnectRequest>") >= 0) {
					this.gotDisconnectRequest();
				}
			}
		};

		instance.initialize(config, guiDescription, additionalExcludedJoins);
		return instance;
	}
};

CF.modules.push({
	name:"CrestronMobile",			// the name of this module
	setup:CrestronMobile.setup,		// the setup function to call before CF.userMain
	object:CrestronMobile,			// the `this' object for the setup function
	version:"v3.4.1"			// the version of this module
});
