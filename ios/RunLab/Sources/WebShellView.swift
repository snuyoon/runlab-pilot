import SwiftUI
import WebKit

/// RunLab 웹앱(Vercel)을 감싸는 WKWebView 셸.
///
/// - localStorage/쿠키는 WKWebsiteDataStore.default()로 디스크에 영속 (앱 재실행 유지)
/// - JS → 네이티브: window.webkit.messageHandlers.runlab.postMessage({...})
/// - 네이티브 셸 감지: UA 접미사("RunLabNative") + window.__RUNLAB_NATIVE__ 플래그 주입
struct WebShellView: UIViewRepresentable {
    static let baseURL = URL(string: "https://runlab-pilot.vercel.app")!
    static let allowedHosts = ["runlab-pilot.vercel.app", "localhost"]

    let router: WebRouter

    func makeCoordinator() -> Coordinator {
        Coordinator(router: router)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // 영속 저장 (기본값이지만 명시)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = [] // 웹 알람음(WebAudio) 폴백 허용
        config.applicationNameForUserAgent = "RunLabNative/1.0"
        config.userContentController.add(context.coordinator, name: "runlab")

        // 문서 파싱 전에 네이티브 플래그 주입
        let flagScript = WKUserScript(
            source: "window.__RUNLAB_NATIVE__ = { platform: 'ios', version: '1.0' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        config.userContentController.addUserScript(flagScript)

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never // 웹이 safe-area 직접 처리
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.97, green: 0.98, blue: 0.99, alpha: 1)
        context.coordinator.webView = webView

        // 당겨서 새로고침
        let refresh = UIRefreshControl()
        refresh.addTarget(
            context.coordinator,
            action: #selector(Coordinator.handleRefresh(_:)),
            for: .valueChanged
        )
        webView.scrollView.refreshControl = refresh

        // 콜드 런치 딥링크: 알람으로 앱이 켜졌으면 처음부터 해당 경로(/ema)를 로드
        // (베이스 URL을 먼저 로드했다가 리다이렉트하는 레이스 방지)
        var startURL = Self.baseURL
        if let pending = UserDefaults.standard.string(forKey: WebRouter.pendingPathKey) {
            UserDefaults.standard.removeObject(forKey: WebRouter.pendingPathKey)
            startURL = Self.baseURL.appendingPathComponent(pending)
            context.coordinator.lastHandledPath = pending
            // 잠금 해제: 리셋하지 않으면 이후 같은 경로(/ema) 딥링크가 전부 무시된다
            DispatchQueue.main.async {
                router.pendingPath = nil
                context.coordinator.lastHandledPath = nil
            }
        }
        webView.load(URLRequest(url: startURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // 딥링크 처리 (알람 해제 → /ema 등). 재로드는 여기서 하지 않는다.
        if let path = router.pendingPath, context.coordinator.lastHandledPath != path {
            context.coordinator.lastHandledPath = path
            // 함께 저장된 콜드런치용 키도 소비 — 남겨두면 다음 콜드 런치가 엉뚱하게 /ema로 열린다
            UserDefaults.standard.removeObject(forKey: WebRouter.pendingPathKey)
            let url = Self.baseURL.appendingPathComponent(path)
            webView.load(URLRequest(url: url))
            DispatchQueue.main.async {
                router.pendingPath = nil
                context.coordinator.lastHandledPath = nil
            }
        }
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "runlab")
    }

    // MARK: - Coordinator

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
        weak var webView: WKWebView?
        var lastHandledPath: String?
        private let router: WebRouter

        init(router: WebRouter) {
            self.router = router
        }

        // ── JS → 네이티브 브리지 ──
        func userContentController(
            _ userContentController: WKUserContentController,
            didReceive message: WKScriptMessage
        ) {
            guard message.name == "runlab",
                  let body = message.body as? [String: Any],
                  let type = body["type"] as? String else { return }

            switch type {
            case "syncAlarms":
                let raw = (body["alarms"] as? [[String: Any]]) ?? []
                let specs = raw.compactMap { AlarmSpec($0) }
                AlarmService.sync(specs)
            case "cancelAll":
                AlarmService.cancelAll()
            case "setParticipant":
                if let code = body["code"] as? String {
                    UserDefaults.standard.set(code, forKey: "runlab.participantCode")
                }
            default:
                break
            }
        }

        // ── 내비게이션 정책: 우리 도메인만 웹뷰, 외부는 Safari ──
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.cancel)
                return
            }
            let host = url.host ?? ""
            let isAllowed = WebShellView.allowedHosts.contains { host == $0 || host.hasSuffix(".\($0)") }
            if navigationAction.navigationType == .linkActivated && !isAllowed {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        // target=_blank 링크를 같은 웹뷰에서 열기
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
            }
            return nil
        }

        // JS confirm() 지원 (관리자 화면 등에서 사용)
        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
            presentTopmost(alert)
        }

        // JS alert() 지원
        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
            presentTopmost(alert)
        }

        private func presentTopmost(_ alert: UIAlertController) {
            guard let scene = UIApplication.shared.connectedScenes
                .compactMap({ $0 as? UIWindowScene }).first,
                  let root = scene.keyWindow?.rootViewController else { return }
            var top = root
            while let presented = top.presentedViewController { top = presented }
            top.present(alert, animated: true)
        }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
            sender.endRefreshing()
        }
    }
}
