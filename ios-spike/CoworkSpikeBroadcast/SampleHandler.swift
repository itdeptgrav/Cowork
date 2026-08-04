import LiveKit

#if os(iOS)
@available(macCatalyst 13.1, *)
class SampleHandler: LKSampleHandler, @unchecked Sendable {
    override var enableLogging: Bool { true }

    /// The only override point the SDK exposes — `broadcastStarted`,
    /// `broadcastFinished` and `processSampleBuffer` are declared `public`
    /// rather than `open`, so a subclass outside LiveKit cannot hook them.
    ///
    /// It is still the signal that matters most: the socket to the host closes
    /// when the broadcast dies, including the lock-screen teardown where
    /// `broadcastFinished()` may never run. Stamping it here lets the app spot
    /// a death it never received a notification for.
    override func connectionDidClose(error: Error?) {
        BroadcastState.markFinished()
        super.connectionDidClose(error: error)
    }
}
#endif
