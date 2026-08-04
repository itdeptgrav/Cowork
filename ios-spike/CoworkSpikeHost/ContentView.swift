import SwiftUI
import UIKit

/// Native shell: the whole app is the Cowork web app in a WKWebView, with a
/// thin bridge for the things web can't do (screen broadcast, eventually PiP).
struct ContentView: View {
    /// `@StateObject`, not `let`: SwiftUI re-creates View structs freely, and a
    /// fresh bridge would orphan the message handler the web page posts to.
    @StateObject private var bridge = NativeBridge()

    /// Release builds always talk to the deployed app. A debug build can be
    /// pointed at a dev server on the LAN by setting `COWORK_DEV_URL` in the
    /// scheme's environment — no source edit, so the production URL can never
    /// be left overwritten by an afternoon of local iteration.
    private var coworkURL: URL {
        #if DEBUG
        /* The environment only reaches a process this Mac launched, so an
           env-only override silently reverts to production the moment somebody
           taps the icon on the Home Screen — which looks exactly like the
           native bridge being broken. Remembering it makes one launch stick
           for every launch after it. Pass an empty value to clear. */
        let key = "COWORK_DEV_URL"
        if let override = ProcessInfo.processInfo.environment[key] {
            if override.isEmpty {
                UserDefaults.standard.removeObject(forKey: key)
            } else {
                UserDefaults.standard.set(override, forKey: key)
            }
        }
        if let remembered = UserDefaults.standard.string(forKey: key),
           let url = URL(string: remembered) {
            return url
        }
        /* No override remembered: fall through to the same production URL as
           Release. This USED to default to a hardcoded LAN address instead,
           back when production had not been deployed with the native bridge —
           defaulting anywhere else would have meant "Go online" silently
           falling back to a browser `getDisplayMedia()` call that WKWebView
           cannot satisfy. Production has carried the bridge since the
           2026-08-04 deploy, so an unconfigured Debug build is now safe to
           point at it, and doing so is what makes a Debug build independent of
           any one Mac's IP or a dev server being up. Explicit LAN testing is
           still one `COWORK_DEV_URL` scheme-environment value away. */
        #endif
        return URL(string: "https://cowork.grav.in")!
    }

    var body: some View {
        ZStack {
            WebView(url: coworkURL, bridge: bridge)
                .ignoresSafeArea()

            if bridge.showResumePrompt {
                ResumeScreenShareOverlay { bridge.resumeScreenShare() }
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.2), value: bridge.showResumePrompt)
        /* Two signals, because neither alone covers it: becoming active catches
           a return from the app switcher, while protected-data-available is the
           one that actually fires on unlock — and a locked device is the case
           that kills broadcasts. Both funnel into the same idempotent check. */
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.didBecomeActiveNotification)) { _ in
            bridge.evaluateResumeNeed()
        }
        .onReceive(NotificationCenter.default.publisher(
            for: UIApplication.protectedDataDidBecomeAvailableNotification)) { _ in
            bridge.evaluateResumeNeed()
        }
    }
}

/// Shown only when the person is still meant to be sharing and the broadcast
/// has actually stopped. It is deliberately a dead end with one way out: the
/// button is the user action ReplayKit requires, and nothing here can or should
/// start a broadcast without it.
private struct ResumeScreenShareOverlay: View {
    let onResume: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.86).ignoresSafeArea()

            VStack(spacing: 16) {
                Image(systemName: "rectangle.on.rectangle.slash")
                    .font(.system(size: 44, weight: .light))
                    .foregroundStyle(.white)

                Text("Screen sharing stopped")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)

                Text("iPhone stops screen sharing when the screen is locked. You are still marked online — resume to keep sharing.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 8)

                Button(action: onResume) {
                    Text("Resume screen share")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.white, in: Capsule())
                        .foregroundStyle(.black)
                }
                .padding(.top, 4)

                Text("You'll be asked to tap Start Broadcast.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.5))
            }
            .padding(28)
            .frame(maxWidth: 340)
        }
    }
}

#Preview {
    ContentView()
}
