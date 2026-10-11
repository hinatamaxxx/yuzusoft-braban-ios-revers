import SwiftUI
import WebKit
import AVFoundation
import UniformTypeIdentifiers

/// Hosts the HTML5 game engine bundled under Game/ in a WKWebView.
struct GameView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(context.coordinator.scheme, forURLScheme: "app")
        let ucc = WKUserContentController()
        ucc.add(context.coordinator, name: "store")
        ucc.addScriptMessageHandler(context.coordinator.audio, contentWorld: .page, name: "audio")
        let boot = "window.NATIVE_STORE = \(context.coordinator.store.allJSON());"
        ucc.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = ucc

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsLinkPreview = false
        web.uiDelegate = context.coordinator
        if #available(iOS 16.4, *) { web.isInspectable = true } // debug over USB Web Inspector
        web.load(URLRequest(url: URL(string: "app://game/index.html")!))
        context.coordinator.observe(web)
        context.coordinator.audio.web = web
        // tell the audio code when the system takes a bottom-edge swipe (app switcher)
        let edges = EdgeGestureRecorder(target: nil, action: nil)
        let audio = context.coordinator.audio
        edges.onSystemEdgeGesture = { edge in if edge == .bottom { audio.noteBottomEdgeGesture() } }
        web.addGestureRecognizer(edges)
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler, WKUIDelegate {
        // ship.sh copies resources to the app root; the duplicate inside the resource bundle is removed after the build.
        static let gameRoot = Bundle.main.url(forResource: "Game", withExtension: nil)
            ?? Bundle.module.url(forResource: "Game", withExtension: nil)!
        let scheme = GameSchemeHandler(root: Coordinator.gameRoot)
        let audio = AudioBridge(root: Coordinator.gameRoot)
        let store = SaveStore()
        weak var web: WKWebView?
        private var tokens: [NSObjectProtocol] = []

        /// Re-activate the audio session and tell the page to recover audio after backgrounding or interruptions.
        func observe(_ web: WKWebView) {
            self.web = web
            let nc = NotificationCenter.default
            tokens.append(nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.reactivate()
            })
            tokens.append(nc.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.web?.evaluateJavaScript("window.__appInactive && window.__appInactive()")
            })
            tokens.append(nc.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
                let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                if raw == AVAudioSession.InterruptionType.ended.rawValue { self?.reactivate() }
            })
            tokens.append(nc.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
                self?.reactivate()
            })
        }

        private func reactivate() {
            let session = AVAudioSession.sharedInstance()
            try? session.setCategory(.playback, mode: .default)
            try? session.setActive(true)
            web?.evaluateJavaScript("window.__appActive && window.__appActive()")
        }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "store", let body = message.body as? [String: Any], let key = body["key"] as? String else { return }
            store.set(key: key, value: body["value"] as? String)
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            completionHandler()
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            completionHandler(true)
        }
    }
}

/// Key/value JSON store kept in Documents/save (survives app restarts).
final class SaveStore {
    private let dir: URL
    private let queue = DispatchQueue(label: "save-store")

    init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        dir = docs.appendingPathComponent("save", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    private func file(_ key: String) -> URL {
        let safe = key.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? String($0) : "_" }.joined()
        return dir.appendingPathComponent(safe + ".json")
    }

    func set(key: String, value: String?) {
        queue.async {
            let url = self.file(key)
            if let value {
                try? Data(value.utf8).write(to: url, options: .atomic)
                try? Data(key.utf8).write(to: url.appendingPathExtension("key"), options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: url)
                try? FileManager.default.removeItem(at: url.appendingPathExtension("key"))
            }
        }
    }

    /// JSON object literal { key: "<json string>" } for injection at document start.
    func allJSON() -> String {
        var dict: [String: String] = [:]
        queue.sync {
            let files = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
            for url in files where url.pathExtension == "json" {
                guard let value = try? String(contentsOf: url, encoding: .utf8) else { continue }
                let keyURL = url.appendingPathExtension("key")
                let key = (try? String(contentsOf: keyURL, encoding: .utf8)) ?? url.deletingPathExtension().lastPathComponent
                dict[key] = value
            }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: dict), let s = String(data: data, encoding: .utf8) else { return "{}" }
        return s
    }
}

/// Serves files from the bundled Game directory at app://game/..., with HTTP Range support for media.
final class GameSchemeHandler: NSObject, WKURLSchemeHandler {
    let root: URL
    private var stopped = Set<ObjectIdentifier>()
    private let lock = NSLock()
    private let io = DispatchQueue(label: "game-scheme", qos: .userInitiated, attributes: .concurrent)

    init(root: URL) { self.root = root }

    private static let types: [String: String] = [
        "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8", "css": "text/css; charset=utf-8",
        "webp": "image/webp", "png": "image/png", "m4a": "audio/mp4", "mp4": "video/mp4", "json": "application/json",
    ]

    private func isStopped(_ task: WKURLSchemeTask) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return stopped.contains(ObjectIdentifier(task))
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let path = url.path.removingPercentEncoding ?? url.path
        let rel = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let file = root.appendingPathComponent(rel.isEmpty ? "index.html" : rel).standardizedFileURL
        let range = task.request.value(forHTTPHeaderField: "Range")
        io.async { [weak self] in
            guard let self else { return }
            let fail = {
                DispatchQueue.main.async {
                    if !self.isStopped(task) { task.didFailWithError(URLError(.fileDoesNotExist)) }
                }
            }
            guard file.path.hasPrefix(self.root.standardizedFileURL.path),
                  let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
                  let size = (attrs[.size] as? NSNumber)?.intValue,
                  let handle = try? FileHandle(forReadingFrom: file) else { return fail() }
            defer { try? handle.close() }
            let mime = GameSchemeHandler.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
            var start = 0, end = size - 1, status = 200
            var headers = ["Content-Type": mime, "Accept-Ranges": "bytes", "Access-Control-Allow-Origin": "*"]
            if let range, range.hasPrefix("bytes=") {
                let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
                if let s = parts.first, let v = Int(s) { start = v }
                if parts.count > 1, let v = Int(parts[1]) { end = min(v, size - 1) }
                if parts.first?.isEmpty == true, parts.count > 1, let suffix = Int(parts[1]) { start = max(0, size - suffix); end = size - 1 }
                status = 206
                headers["Content-Range"] = "bytes \(start)-\(end)/\(size)"
            }
            let length = max(0, end - start + 1)
            headers["Content-Length"] = String(length)
            try? handle.seek(toOffset: UInt64(start))
            let data = (try? handle.read(upToCount: length)) ?? Data()
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            DispatchQueue.main.async {
                guard !self.isStopped(task) else { return }
                task.didReceive(response)
                task.didReceive(data)
                task.didFinish()
            }
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        lock.lock(); stopped.insert(ObjectIdentifier(task)); lock.unlock()
    }
}
