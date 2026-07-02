import SwiftUI

struct ContentView: View {
    @ObservedObject private var router = WebRouter.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        WebShellView(router: router)
            .ignoresSafeArea() // 웹이 viewport-fit=cover + env(safe-area-inset)로 처리
            .background(Color(red: 0.97, green: 0.98, blue: 0.99))
            .onAppear {
                router.consumeStoredPath()
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    router.consumeStoredPath()
                }
            }
    }
}
