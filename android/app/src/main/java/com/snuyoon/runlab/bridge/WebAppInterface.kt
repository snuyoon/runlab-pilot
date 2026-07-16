package com.snuyoon.runlab.bridge

import android.webkit.JavascriptInterface

/**
 * 웹 → 네이티브 JS 브리지.
 * WebView.addJavascriptInterface(this, "RunLabAndroid") 로 주입되어
 * 웹에서 window.RunLabAndroid.postMessage(JSON.stringify({...})) 로 호출한다.
 *
 * 주의: @JavascriptInterface 메서드는 바인더(비 UI) 스레드에서 호출된다.
 *       실제 처리는 host 가 메인 스레드로 마샬링한다.
 */
class WebAppInterface(private val host: BridgeHost) {

    interface BridgeHost {
        /** 웹에서 온 원본 JSON 메시지 처리 (구현체가 메인 스레드로 전환) */
        fun onBridgeMessage(json: String)
    }

    @JavascriptInterface
    fun postMessage(json: String) {
        host.onBridgeMessage(json)
    }
}
