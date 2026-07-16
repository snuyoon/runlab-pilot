package com.snuyoon.runlab

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import com.snuyoon.runlab.alarm.AlarmNotifier
import com.snuyoon.runlab.alarm.AlarmScheduler
import com.snuyoon.runlab.alarm.AlarmSpec
import com.snuyoon.runlab.alarm.AlarmStore
import com.snuyoon.runlab.bridge.WebAppInterface
import com.snuyoon.runlab.health.HealthConnectManager
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * RunLab 웹앱(Vercel)을 감싸는 WebView 셸 + JS 브리지 진입점.
 * iOS WebShellView 와 대응한다.
 */
class MainActivity : AppCompatActivity(), WebAppInterface.BridgeHost {

    companion object {
        const val EXTRA_PATH = "path"
        private const val BASE_URL = "https://runlab-pilot.vercel.app"
        private val ALLOWED_HOSTS = listOf("runlab-pilot.vercel.app", "localhost")
        private const val TAG = "RunLab"
        private const val PREF = "runlab.shell"
        private const val KEY_RELIABILITY_SHOWN = "reliabilityGuideShown"
    }

    private lateinit var webView: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var health: HealthConnectManager

    private val notifPermLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            // 알림 프롬프트에 답한 뒤 신뢰성 안내 (다이얼로그가 프롬프트 위에 겹치지 않도록)
            maybeShowReliabilityGuide()
        }

    private val healthPermLauncher =
        registerForActivityResult(PermissionController.createRequestPermissionResultContract()) { granted ->
            if (granted.containsAll(HealthConnectManager.PERMISSIONS)) fetchAndPushHealth()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        AlarmNotifier.ensureChannel(this)
        health = HealthConnectManager(this)

        setContentView(R.layout.activity_main)
        swipe = findViewById(R.id.swipe)
        webView = findViewById(R.id.webview)
        setupWebView()

        requestRuntimePermissions()

        // Health Connect 권한 근거 화면 요청이면 개인정보 처리방침으로
        val startPath = when {
            isRationaleIntent(intent) -> "/privacy"
            else -> intent.getStringExtra(EXTRA_PATH)
        }
        webView.loadUrl(BASE_URL + (startPath ?: ""))
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val path = when {
            isRationaleIntent(intent) -> "/privacy"
            else -> intent.getStringExtra(EXTRA_PATH)
        }
        if (path != null) webView.loadUrl(BASE_URL + path)
    }

    private fun isRationaleIntent(intent: Intent?): Boolean {
        val a = intent?.action ?: return false
        return a == "androidx.health.connect.action.SHOW_PERMISSIONS_RATIONALE" ||
            a == "android.intent.action.VIEW_PERMISSION_USAGE"
    }

    @Suppress("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true                       // localStorage 영속 (앱 재실행 유지)
            databaseEnabled = true
            mediaPlaybackRequiresUserGesture = false        // 웹 알람음(WebAudio) 폴백 허용
            javaScriptCanOpenWindowsAutomatically = true
            userAgentString = "$userAgentString RunLabNative/1.0"
        }
        webView.addJavascriptInterface(WebAppInterface(this), "RunLabAndroid")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return false
                val allowed = ALLOWED_HOSTS.any { host == it || host.endsWith(".$it") }
                if (!allowed) {
                    // 외부 링크는 기본 브라우저로
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                    }
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                view.evaluateJavascript(
                    "window.__RUNLAB_NATIVE__ = { platform: 'android', version: '1.0' };",
                    null
                )
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                swipe.isRefreshing = false
            }
        }

        swipe.setOnRefreshListener { webView.reload() }
    }

    // ── 뒤로가기: 웹 히스토리 우선 ──
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    // ── JS → 네이티브 브리지 (WebAppInterface.BridgeHost) ──
    override fun onBridgeMessage(json: String) {
        runOnUiThread {
            try {
                val msg = JSONObject(json)
                when (msg.optString("type")) {
                    "syncAlarms" -> {
                        val specs = parseAlarms(msg.optJSONArray("alarms"))
                        val diag = AlarmScheduler.sync(this, specs)
                        emitAlarmDiag(diag)
                    }
                    "cancelAll" -> {
                        val diag = AlarmScheduler.cancelAll(this)
                        emitAlarmDiag(diag)
                    }
                    "setParticipant" -> AlarmStore.saveParticipant(this, msg.optString("code"))
                    "getAlarmDiag" -> emitAlarmDiag(AlarmStore.loadDiag(this))
                    "requestHealthKit" -> requestHealthAndSync()
                    "healthKitSync" -> healthSyncIfEnabled()
                }
            } catch (e: Exception) {
                Log.e(TAG, "브리지 메시지 처리 실패: $json", e)
            }
        }
    }

    private fun parseAlarms(arr: JSONArray?): List<AlarmSpec> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { AlarmSpec.from(arr.getJSONObject(it)) }
    }

    private fun emitAlarmDiag(diagJson: String) {
        evalJs("window.__runlabAlarmResult && window.__runlabAlarmResult($diagJson)")
    }

    private fun evalJs(js: String) {
        // org.json 은 U+2028/U+2029 를 이스케이프하지 않는데, 이는 JSON 에선 유효하지만
        // JS 에선 줄 종결자라 evaluateJavascript 문자열 전체가 SyntaxError 로 죽는다 → 이스케이프.
        val safe = js.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        runOnUiThread { webView.evaluateJavascript(safe, null) }
    }

    // ── Health Connect ──
    private fun requestHealthAndSync() {
        when (health.sdkStatus()) {
            HealthConnectClient.SDK_UNAVAILABLE -> {
                Log.i(TAG, "이 기기는 Health Connect 미지원")
            }
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> {
                openHealthConnectInStore()
            }
            else -> lifecycleScope.launch {
                try {
                    if (health.hasAllPermissions()) fetchAndPushHealth()
                    else healthPermLauncher.launch(HealthConnectManager.PERMISSIONS)
                } catch (e: Exception) {
                    Log.e(TAG, "Health 권한 확인 실패", e)
                }
            }
        }
    }

    private fun healthSyncIfEnabled() {
        if (!health.isAvailable()) return
        lifecycleScope.launch {
            try {
                if (health.hasAllPermissions()) fetchAndPushHealth()
            } catch (e: Exception) {
                Log.e(TAG, "Health 동기화 실패", e)
            }
        }
    }

    private fun fetchAndPushHealth() {
        lifecycleScope.launch {
            try {
                val sessions = health.fetchRunningSessions()
                for (s in sessions) {
                    evalJs("window.__runlabWorkout && window.__runlabWorkout($s)")
                }
                Log.i(TAG, "Health 러닝 세션 ${sessions.size}건 전달")
            } catch (e: Exception) {
                Log.e(TAG, "러닝 세션 조회 실패", e)
            }
        }
    }

    private fun openHealthConnectInStore() {
        val pkg = "com.google.android.apps.healthdata"
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))
        } catch (_: ActivityNotFoundException) {
            startActivity(
                Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))
            )
        }
    }

    // ── 런타임 권한 + 알람 신뢰성 안내 ──
    private fun requestRuntimePermissions() {
        // Android 13+ 알림 권한 (알람 표시 필수) — 미승인이면 프롬프트, 결과 콜백에서 가이드
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED
        ) {
            notifPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            maybeShowReliabilityGuide()
        }
    }

    private fun notificationsEnabled(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(this).areNotificationsEnabled()
        }

    /**
     * 알람이 앱을 닫아도 매일 울리도록 필요한 설정을 한 화면으로 안내.
     * - 알림/전체화면 권한 미승인, 또는 삼성 기기(앱 절전 문제)면 표시.
     * - 삼성 안내는 1회만(문제 없으면). 알림 미승인은 발생 시 계속 안내.
     * (삼성 '절전 안 함 앱' 등록은 공개 API가 없어 사용자 안내만 가능)
     */
    private fun maybeShowReliabilityGuide() {
        val notifOk = notificationsEnabled()
        val fsiOk = AlarmNotifier.canUseFullScreenIntent(this)
        val isSamsung = Build.MANUFACTURER.equals("samsung", ignoreCase = true)
        val prefs = getSharedPreferences(PREF, Context.MODE_PRIVATE)

        val allGood = notifOk && fsiOk
        if (allGood && (!isSamsung || prefs.getBoolean(KEY_RELIABILITY_SHOWN, false))) return
        // 삼성 1회 안내 마커는 '순수 배터리 안내'로 떴을 때만 소비 —
        // 알림/전체화면 문제로 떴을 땐(allGood=false) 소비하지 않아 나중에 배터리 안내가 다시 뜬다.
        if (isSamsung && allGood) prefs.edit().putBoolean(KEY_RELIABILITY_SHOWN, true).apply()

        val msg = buildString {
            append("기상 알람이 앱을 닫아도 매일 울리려면 아래 설정이 필요해요.\n\n")
            if (!notifOk || !fsiOk) {
                append("확인이 필요한 권한:\n")
                if (!notifOk) append("• 알림 권한 (알람 표시에 필수)\n")
                if (!fsiOk) append("• 전체 화면 알람 표시\n")
                append("\n")
            }
            if (isSamsung) {
                append("삼성 갤럭시는 앱을 '절전'시키면 밤새 알람이 안 울릴 수 있어요:\n")
                append("① 설정 → 배터리 → 백그라운드 사용 제한 → '사용 안 하는 앱을 절전' 끄기\n")
                append("② 같은 화면의 '절전 안 함 앱'에 RunLab 추가\n\n")
            }
            append("아래 버튼으로 관련 설정 화면을 열 수 있어요.")
        }

        val builder = AlertDialog.Builder(this)
            .setTitle("알람 설정 확인")
            .setMessage(msg)
            .setNegativeButton("나중에", null)
        when {
            !notifOk -> builder.setPositiveButton("알림 설정 열기") { _, _ -> openAppNotificationSettings() }
            !fsiOk -> builder.setPositiveButton("전체화면 알람 설정") { _, _ -> openFullScreenIntentSettings() }
            else -> builder.setPositiveButton("배터리 설정 열기") { _, _ -> openBatteryOptimizationSettings() }
        }
        if ((!notifOk || !fsiOk) && (isSamsung)) {
            builder.setNeutralButton("배터리 설정") { _, _ -> openBatteryOptimizationSettings() }
        }
        builder.show()
    }

    private fun openAppNotificationSettings() {
        try {
            startActivity(
                Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
            )
        } catch (_: ActivityNotFoundException) {
        }
    }

    private fun openFullScreenIntentSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (_: ActivityNotFoundException) {
            }
        }
    }

    // Play 정책 안전: 직접 요청 프롬프트(ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)가 아니라
    // 배터리 최적화 '목록' 화면으로 딥링크 (권한 불필요).
    private fun openBatteryOptimizationSettings() {
        try {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (_: ActivityNotFoundException) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS))
            } catch (_: Exception) {
            }
        }
    }
}
