package app.pinprick;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Runs the bundled game (assets/index.html, built by tools/build.mjs) full screen in a WebView.
 * The page does all the work; this class only provides immersive mode, keeps the screen on,
 * pauses the game when the app is backgrounded and routes the back button into the game.
 */
public class MainActivity extends Activity {
    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        // the bars are hidden, but keep the page clear of the camera cutout
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets cut = insets.getInsets(WindowInsets.Type.displayCutout());
            v.setPadding(cut.left, cut.top, cut.right, cut.bottom);
            return WindowInsets.CONSUMED;
        });

        web = new WebView(this);
        web.setBackgroundColor(Color.BLACK);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);              // settings, best times, unlocked levels
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // the app only ever shows its own bundled page
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        immersive();

        web.loadUrl("file:///android_asset/index.html");
    }

    private void immersive() {
        WindowInsetsController c = getWindow().getInsetsController();
        if (c == null) return;
        c.hide(WindowInsets.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.pinprickPause && window.pinprickPause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // the game pauses, resumes or closes a menu; on the title screen it returns false and we exit
        web.evaluateJavascript("!!(window.pinprickBack && window.pinprickBack())", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
