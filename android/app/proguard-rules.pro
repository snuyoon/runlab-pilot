# JS 브리지로 웹에서 호출되는 인터페이스 메서드는 난독화/제거 금지
-keepclassmembers class com.snuyoon.runlab.bridge.WebAppInterface {
    @android.webkit.JavascriptInterface <methods>;
}
# Health Connect 레코드 클래스 유지
-keep class androidx.health.connect.client.records.** { *; }
