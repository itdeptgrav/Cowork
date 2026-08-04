import Foundation

/// Broadcast liveness, shared between the app and its upload extension.
///
/// A heartbeat written from `processSampleBuffer` would be the ideal signal,
/// but LiveKit declares that method `public` rather than `open`, so a subclass
/// outside the SDK cannot hook it. What is left is a death marker: the
/// extension stamps `finishedAt` when its socket closes — which includes the
/// lock-screen teardown, where `broadcastFinished()` may never run.
///
/// The app pairs that with `BroadcastManager.isBroadcasting`. Either signal
/// alone can lie: a Darwin notification posted while the app was suspended may
/// never arrive, leaving `isBroadcasting` stuck true; and the marker alone
/// cannot tell a fresh start from an old corpse. Compared against the start
/// stamp, together they are dependable.
enum BroadcastState {
    private static let startedAtKey = "broadcastStartedAt"
    private static let finishedAtKey = "broadcastFinishedAt"

    /// Derived exactly as LiveKit's `BroadcastBundleInfo` does, so both sides
    /// agree without either hardcoding the identifier. In the extension the
    /// bundle id carries a `.broadcast` suffix; drop it to reach the app's.
    static var groupIdentifier: String? {
        guard let bundleIdentifier = Bundle.main.bundleIdentifier else { return nil }
        let suffix = ".broadcast"
        let appIdentifier = bundleIdentifier.hasSuffix(suffix)
            ? String(bundleIdentifier.dropLast(suffix.count))
            : bundleIdentifier
        return "group.\(appIdentifier)"
    }

    private static var defaults: UserDefaults? {
        guard let groupIdentifier else { return nil }
        return UserDefaults(suiteName: groupIdentifier)
    }

    /// Written by the app the moment a broadcast is seen to start.
    static func markStarted() {
        defaults?.set(Date(), forKey: startedAtKey)
    }

    /// Written by the extension when its connection to the app closes.
    static func markFinished() {
        defaults?.set(Date(), forKey: finishedAtKey)
    }

    /// True when a death has been recorded since the last start — the case a
    /// missed notification would otherwise hide.
    static var diedSinceStart: Bool {
        guard let defaults,
              let finishedAt = defaults.object(forKey: finishedAtKey) as? Date
        else { return false }
        guard let startedAt = defaults.object(forKey: startedAtKey) as? Date else { return true }
        return finishedAt > startedAt
    }
}
