# Crestron module for CommandFusion iViewer via Crestron Mobile Symbol

This project allows iViewer to communicate with a Crestron processor using the native Crestron Mobile symbol in your SIMPL projects.
This offers far better Ethernet reliability than using TCP Server via SIMPL+, which the original iViewer Server SIMPL+ module was forced to use.

## Requirements

1. iViewer 4 or newer (with JavaScript support)
2. Crestron processor with firmware v??

## Features

CrestronMobile v3 allows your iViewer GUI to support multiple simultaneous connections to several Crestron boxes.
Is is made of the following components:

* a SIMPL module that you install on your Crestron processors
* a Javascript module for iViewer that you add to your GUI

CrestronMobile allows you to control one of more Crestron processors right from your GUI. You can be simultaneously
connected to multiple processors. You can also configure which GUI pages relate to which processor, and CrestronMobile
will automatically transmit join upates for the contents on the related pages to the relevant processor and only to
this one.

## Using CrestronMobile

### Crestron Processor setup

Install the CrestronMobile SIMPL program on your Crestron processor(s). The default is to use TCP port 50100 for communication with iViewer.
If you change the port number, remember to customize your GUI's external systems as well (see below).

### iViewer integration

CrestronMobile v3 is more powerful than the previously released version (v1.1). It supports running in a **compatibility mode** where
you don't perform any configuration and the script automatically configures itself by using the external system named __CrestronMobile__
which must be present in your GUI.

To customize CrestronMobile and/or support connection to multiple Crestron processors, you'll want to special configuration objects
to your Javascript code that CrestronMobile will automatically recognize and use for configuration.

Please look at the following relevant wiki pages for configuration information:

* [Preparing for CrestronMobile v3](https://github.com/CommandFusion/CrestronMobile/wiki/Preparing-for-CrestronMobile)
* [Configuring CrestronMobile v3](https://github.com/CommandFusion/CrestronMobile/wiki/Configuring-CrestronMobile-v3)


## Contributors

* Programmed by Greg Soli, Audio Advice
* Improved by Florent Pillet, CommandFusion
