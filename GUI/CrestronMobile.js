var heartbeatTimer = 0;
var xmlBuffer = "";
var updateComplete = false;
var digitalJoinRepeat = [];
var analogJoinValue = [];

var CrestronMobile = {
	
	sendData: function(data){
		if(updateComplete == true){
			CF.send("CrestronMobile", data);			
		}		
	},
	
	//Function to decode UTF text for serial strings
	decode : function (utftext) {
		var string = "";
		var i = 0;
		var c = c1 = c2 = 0;
 
		while ( i < utftext.length ) {
 
			c = utftext.charCodeAt(i);
 
			if (c < 128) {
				string += String.fromCharCode(c);
				i++;
			}
			else if((c > 191) && (c < 224)) {
				c2 = utftext.charCodeAt(i+1);
				string += String.fromCharCode(((c & 31) << 6) | (c2 & 63));
				i += 2;
			}
			else {
				c2 = utftext.charCodeAt(i+1);
				c3 = utftext.charCodeAt(i+2);
				string += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63));
				i += 3;
			}
 
		}
		return string;
	},
	
	onButtonPressed: function(join, value, tokens){
		var data;
		var id;
		
		id = join.substring(1);
		data = "<cresnet><data><bool id=\"" + id + "\" value=\"true\" repeating=\"true\"/></data></cresnet>";
		CrestronMobile.sendData(data);		
		digitalJoinRepeat[id] = setInterval("CrestronMobile.sendData('"+ data +"')", 500);		
	},
	
	onButtonReleased: function(join, value, tokens){
		var data;
		var id;

		id = join.substring(1);
		clearInterval(digitalJoinRepeat[id]);		
		data = "<cresnet><data><bool id=\"" + id + "\" value=\"false\" repeating=\"true\"/></data></cresnet>";	
		CrestronMobile.sendData(data);								
	},
	
	onAnalogChanged: function(join, value){	
		var data;
		var id;
		
		id = join.substring(1);
		
		if(analogJoinValue[id] !== parseInt(value/655)){
			data = "<cresnet><data><i32 id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>";	
			CrestronMobile.sendData(data);	
			analogJoinValue[id] = parseInt(value/655);						
		}		
	},

	onSerialChanged: function(join, value){	
		var data;
		var id;
		
		id = join.substring(1);
		data = "<cresnet><data><string id=\"" + id + "\" value=\"" + value + "\"/></data></cresnet>";	
		CrestronMobile.sendData(data);			
	},
		
	onSystemConnectionChanged: function(system, connected, remote){
		var joins = [];

		if(system == "CrestronMobile"){
			if(connected == 1){
			//Socket is connected
			}else if(connected == 0){
				updateComplete = false;
				clearInterval(heartbeatTimer);
				//Digital Joins: Loop through the joins, starting at 1 and add to the joins array
				for(i=1; i<=4000; i++)
				{
					joins.push({
						join: "d" + i,
						value: 0
					});				
				}
				//Analog Joins: Loop through the joins, starting at 1 and add to the joins array			
				for(i=1; i<=4000; i++)
				{
					joins.push({
						join: "a" + i,
						value: 0
					});	
				}
				//Serial Joins: Loop through the joins, starting at 1 and add to the joins array				
				for(i=1; i<=4000; i++)
				{
					joins.push({
						join: "s" + i,
						value: ""
					});	
				}	
			}
			//Send the joins array to CF				
			CF.setJoins(joins);								
		}		
	},

	sendHeartBeat: function(){
		CrestronMobile.sendData("<cresnet><control><comm><heartbeatRequest><data></data></heartbeatRequest></comm></control></cresnet>");	
	},
	
	parseXML: function(xmlData){
		var xml$ = [];
		var parser = new DOMParser();
		var xmlDoc;
		var tempJoin="";
		var tempValue="";
		var tempSerial="";
		var digitals=[];
		var digitalJoins=[];
		var serials=[];
		var serialJoins=[];	
		var analogs=[];
		var analogJoins=[];				
		var temp$="";
		
		xml$ = xmlData.split("<cresnet>");
		
		for (var i=0; i < xml$.length; i++) {
			try{
				xmlDoc = parser.parseFromString(xml$[i], "text/xml");

				if(xml$[i].indexOf("bool") > 0){
					//Found Digital(bool) Element, get all instances in message and parse
					digitals = xmlDoc.getElementsByTagName("bool");
					
					for (var d=0; d < digitals.length; d++) {
						tempJoin = "d" + xmlDoc.getElementsByTagName("bool")[d].getAttributeNode("id").nodeValue;
						tempValue = xmlDoc.getElementsByTagName("bool")[d].getAttributeNode("value").nodeValue;
						
						if(tempValue == "true"){
							tempValue = 1;	
						}else{					
							tempValue = 0;						
						} 	
						
						digitalJoins.push({join: tempJoin, value: tempValue});						
					};
				}else if(xml$[i].indexOf("string") > 0){
					//Found Serial(string) Element, get all instances in message and parse	
					serials = xmlDoc.getElementsByTagName("string");
					
					for (var s=0; s < serials.length; s++) {
						tempJoin = "s" + xmlDoc.getElementsByTagName("string")[s].getAttributeNode("id").nodeValue;
						
						if(xml$[i].indexOf("value=") > 0){
							tempValue = xmlDoc.getElementsByTagName("string")[s].getAttributeNode("value").nodeValue;
						}else if(xml$[i].indexOf("></string>") > 0){
							tempValue = "";	
						}else{
							tempValue = xmlDoc.getElementsByTagName("string")[s].childNodes[0].nodeValue;							
						}

						if(tempValue.length == 0){
							tempSerial = "";							
						}else{
							tempSerial = tempValue;
						}

						if(tempSerial.length > 0){
							tempSerial = CrestronMobile.decode(tempSerial);							
						}

						serialJoins.push({join: tempJoin, value: tempSerial});
					};
				}else if(xml$[i].indexOf("i32") > 0){
					//Found Analog(i32) Element, get all instances in message and parse							
					analogs = xmlDoc.getElementsByTagName("i32");
					
					for (var a=0; a < analogs.length; a++) {
						tempJoin = "a" + xmlDoc.getElementsByTagName("i32")[a].getAttributeNode("id").nodeValue;
						
						if(xml$[i].indexOf("value=") > 0){
							tempValue = xmlDoc.getElementsByTagName("i32")[a].getAttributeNode("value").nodeValue;
						}else{
							tempValue = xmlDoc.getElementsByTagName("i32")[a].childNodes[0].nodeValue;							
						}						
						
						analogJoins.push({join: tempJoin, value: tempValue});
					};					
				}
			}catch(ex){
					
			}							
		};
		//Update Joins on Panel
		CF.setJoins(serialJoins, false);		
		CF.setJoins(digitalJoins, false);
		CF.setJoins(analogJoins, false);					
	},
	
	processFeedback: function(feedbackname, matchedstring){
		if(matchedstring.indexOf("<programReady><status>02") > 0){
			//Found Program Ready Message, send Connect Request to system
			CF.send("CrestronMobile", "<cresnet><control><comm><connectRequest><passcode>1234</passcode><mode isUnicodeSupported=\"true\"></mode></connectRequest></comm></control></cresnet>");						
		}else if(matchedstring.indexOf("<connectResponse>") > 0){
			//Found Connect Response Message, validate response
			if(matchedstring.indexOf("<code>0</code>") > 0){
				//Connection is good, send Update Request Message to system
				CF.send("CrestronMobile", "<cresnet><data><updateRequest></updateRequest></data></cresnet>");						
			}
		}else if(matchedstring.indexOf("endOfUpdate") > 0){
			//Update Finished, begin sending Heartbeat Message
			xmlBuffer += matchedstring;
			CrestronMobile.parseXML(xmlBuffer);
			xmlBuffer = "";
			updateComplete = true;				
			heartbeatTimer = setInterval(CrestronMobile.sendHeartBeat, 5000);
		}else{
			if(updateComplete == true){
				CrestronMobile.parseXML(matchedstring);	
			}else if(updateComplete == false){
				xmlBuffer+=matchedstring;				
			}			
		}
	}
};

CF.userMain = function(){
	var digitalJoins = [];
	var analogJoins = [];
	var serialJoins = [];
	
	for (var i=1; i <= 4000; i++) {
		digitalJoins.push("d" + i);
		analogJoins.push("a" + i);
		serialJoins.push("s" + i);
	};
	
	CF.watch(CF.ConnectionStatusChangeEvent, "CrestronMobile", CrestronMobile.onSystemConnectionChanged, true);	
	CF.watch(CF.FeedbackMatchedEvent, "CrestronMobile", "Feedback", CrestronMobile.processFeedback);
	CF.watch(CF.ObjectPressedEvent, digitalJoins, CrestronMobile.onButtonPressed);	
	CF.watch(CF.ObjectReleasedEvent, digitalJoins, CrestronMobile.onButtonReleased);
	CF.watch(CF.ObjectDraggedEvent, analogJoins, CrestronMobile.onAnalogChanged);
	CF.watch(CF.JoinChangeEvent, serialJoins, CrestronMobile.onSerialChanged);		
};
