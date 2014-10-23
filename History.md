
0.8.1 / 2014-10-23
==================

 * Set the iframe to absolute to stay out of the dom layout (and create scrollbars)

0.8.0 / 2014-10-22
==================

 * Fixed issues with the signalling data channel
 * Removed app signal connect hack
 * Don't close the entire peer-channel because a single channel closed
 * Implemented json, string and binary message support
 * Stricted state checking in peer-channel
 * Changed the debug naming format

0.7.1 / 2014-10-14
==================

 * Silence the 'sending to peer without open data channel' warning, now a debug()

0.7.0 / 2014-10-13
==================

 * Remove bridge on socket close.

0.6.0 / 2014-09-05
==================

 * Added media constraints to offer/answer
 * Added back google stun server as default ice server

0.5.0 / 2014-09-04
==================

 * Fixed some issue with closing a signal

0.4.0 / 2014-09-04
==================

 * Send the request-for-offer when negotiationneeded
 * Logging more and less

0.3.0 / 2014-09-04
==================

 * Renamed the 'servers' option to 'connection'
 * Debug level on the ignoring peer logs
 * Accept an array of turn configs from the app channel signal

0.2.0 / 2014-08-22
==================

 * Added a signal muxer for upgrading to a data channel signal
