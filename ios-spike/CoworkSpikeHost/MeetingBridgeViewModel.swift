import Combine
import Foundation
import LiveKit

/// Owns the native side of screen-sharing during a meeting: connects a LiveKit
/// Room using credentials handed over by the web app, publishes the
/// broadcast-capturer track, then hands off to the system broadcast picker.
/// Mirrors what the ios-spike proved out manually.
@MainActor
final class MeetingBridgeViewModel: ObservableObject {
    private var room: Room?

    @Published var isBroadcasting = false

    /// Whether the person is meant to be sharing right now.
    ///
    /// This is intent, not state: it stays true when iOS kills the broadcast at
    /// lock, which is exactly what lets the app tell "it died and should come
    /// back" apart from "they deliberately stopped". Only an explicit stop, or
    /// the web going offline, clears it.
    @Published private(set) var wantsScreenShare = false

    private var cancellables = Set<AnyCancellable>()

    init() {
        BroadcastManager.shared.isBroadcastingPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] value in
                self?.isBroadcasting = value
                if value {
                    // Anchors the death marker: a `finishedAt` older than this
                    // belongs to a previous broadcast, not this one.
                    BroadcastState.markStarted()
                } else {
                    self?.teardownRoom()
                }
            }
            .store(in: &cancellables)
    }

    func startScreenShare(url: String, token: String) async throws {
        do {
            let room = Room()
            self.room = room
            try await room.connect(url: url, token: token)

            let track = LocalVideoTrack.createBroadcastScreenCapturerTrack(
                name: "employee-screen",
                source: .screenShareVideo
            )
            try await room.localParticipant.publish(videoTrack: track)

            wantsScreenShare = true
            BroadcastManager.shared.requestActivation()
        } catch {
            teardownRoom()
            throw error
        }
    }

    func stopScreenShare() {
        // Deliberate stop: clear the intent first, so the death of the
        // broadcast that follows is not mistaken for one to recover from.
        wantsScreenShare = false
        BroadcastManager.shared.requestStop()
    }

    /// True when the person should be sharing but nothing is actually alive.
    /// Read on unlock/foreground to decide whether to offer a resume.
    ///
    /// Two independent reasons to believe it is dead, because either can be
    /// missed on its own: LiveKit's own flag, and the extension's death marker
    /// for the case where the notification behind that flag never arrived.
    var needsResume: Bool {
        guard wantsScreenShare else { return false }
        return !BroadcastManager.shared.isBroadcasting || BroadcastState.diedSinceStart
    }

    private func teardownRoom() {
        Task { [room] in
            await room?.disconnect()
        }
        room = nil
    }
}
