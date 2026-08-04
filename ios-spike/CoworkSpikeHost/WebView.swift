import Combine
import SwiftUI
import UIKit
@preconcurrency import WebKit

/// Bridges JS on the Cowork web page to native capabilities the web can't do
/// itself: connecting a LiveKit Room and starting/stopping a screen broadcast.
///
/// Web → native:
///   window.webkit.messageHandlers.coworkNative.postMessage({
///     action: "startScreenShare", url: "wss://...", token: "..."
///   })
///   window.webkit.messageHandlers.coworkNative.postMessage({ action: "stopScreenShare" })
///
/// Native → web, when the page defines them:
///   window.CoworkNativeEvents.onScreenShareState(isSharing, error)
///   window.CoworkNativeEvents.onResumeScreenShare()   // asked to re-run "go online"
@MainActor
/// The class is `@MainActor`, and WebKit delivers script messages on the main
/// thread, so the handler below is isolated rather than `nonisolated` — which
/// is also what lets it read `message.body` at all.
final class NativeBridge: NSObject, ObservableObject, WKScriptMessageHandler {
    let meeting = MeetingBridgeViewModel()
    weak var webView: WKWebView?

    /// Shown when the person is meant to be sharing but the broadcast is dead —
    /// which on iOS is overwhelmingly "the phone was locked".
    @Published var showResumePrompt = false

    private var cancellables = Set<AnyCancellable>()

    override init() {
        super.init()
        meeting.$isBroadcasting
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] isBroadcasting in
                guard let self else { return }
                // A live broadcast answers the prompt's question.
                if isBroadcasting { self.showResumePrompt = false }
                self.emitScreenShareState(isSharing: isBroadcasting, error: nil)
            }
            .store(in: &cancellables)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }

        switch action {
        case "startScreenShare":
            guard let url = body["url"] as? String, let token = body["token"] as? String else { return }
            Task {
                do {
                    try await meeting.startScreenShare(url: url, token: token)
                } catch {
                    emitScreenShareState(isSharing: false, error: "\(error)")
                }
            }
        case "stopScreenShare":
            meeting.stopScreenShare()
            showResumePrompt = false
        default:
            break
        }
    }

    /// Called when the app returns to the foreground, and again when the device
    /// is unlocked. iOS will not let the app restart a broadcast on its own —
    /// `RPSystemBroadcastPickerView` is a user-tapped control — so the most that
    /// can be done is notice quickly and offer a one-tap way back.
    func evaluateResumeNeed() {
        guard meeting.needsResume else { return }
        showResumePrompt = true
    }

    /// The resume itself. Credentials are re-fetched by the web app rather than
    /// cached here: a token minted before the lock may well have expired.
    func resumeScreenShare() {
        showResumePrompt = false
        webView?.evaluateJavaScript(
            "window.CoworkNativeEvents && window.CoworkNativeEvents.onResumeScreenShare && window.CoworkNativeEvents.onResumeScreenShare();"
        )
    }

    private func emitScreenShareState(isSharing: Bool, error: String?) {
        let errorLiteral: String
        if let error {
            let escaped = error
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
            errorLiteral = "\"\(escaped)\""
        } else {
            errorLiteral = "undefined"
        }
        let js = "window.CoworkNativeEvents && window.CoworkNativeEvents.onScreenShareState(\(isSharing), \(errorLiteral));"
        webView?.evaluateJavaScript(js)
    }
}

/// Handles the parts of being a browser that WKWebView does not do by default.
final class WebViewUIDelegate: NSObject, WKUIDelegate {
    /// `window.open` returns nil in a WKWebView unless this is implemented, so
    /// without it the call silently does nothing — which is what breaks
    /// attachments, the image lightbox and opening a report.
    func webView(_ webView: WKWebView,
                 createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = navigationAction.request.url else { return nil }

        // Cowork's own pages load in place — the back-swipe gesture is the way
        // out. Anything else is somebody else's site and belongs in Safari,
        // where the address bar makes it clear they have left the app.
        if let host = url.host, host == webView.url?.host {
            webView.load(navigationAction.request)
        } else {
            UIApplication.shared.open(url)
        }
        return nil
    }

    /// Meetings need the camera and microphone. Without this the prompt is
    /// never asked and capture simply fails; iOS still shows its own
    /// system permission alert the first time, so this is not a bypass.
    func webView(_ webView: WKWebView,
                 requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        // Only the app's own origin is trusted; anything else is refused
        // outright rather than handed a camera.
        guard origin.host == webView.url?.host else {
            decisionHandler(.deny)
            return
        }
        decisionHandler(.grant)
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    let bridge: NativeBridge

    func makeCoordinator() -> WebViewUIDelegate { WebViewUIDelegate() }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(bridge, name: "coworkNative")

        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        // Cookie-based auth needs a persistent (non-ephemeral) data store so
        // the sign-in session survives app relaunches like Safari would.
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.allowsBackForwardNavigationGestures = true
        webView.uiDelegate = context.coordinator

        #if DEBUG
        // Lets Safari's Develop menu attach over USB. Never in a release build:
        // it would expose the signed-in workspace to anyone with a cable.
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        bridge.webView = webView

        /* A dev server reuses chunk URLs across restarts, so WKWebView will
           serve a stale — or previously failed — response for them; bypassing
           the cache is the only way to iterate. Release builds must NOT do
           this: it would refetch the whole app on every launch. Cookies live
           in the data store, not the URL cache, so the session survives either
           way. */
        #if DEBUG
        let policy: URLRequest.CachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        #else
        let policy: URLRequest.CachePolicy = .useProtocolCachePolicy
        #endif
        webView.load(URLRequest(url: url, cachePolicy: policy, timeoutInterval: 30))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
