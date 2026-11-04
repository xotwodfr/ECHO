//! ECHO for Linux: GTK 4, GStreamer and libsecret. The baseline every native client has: sign in
//! with a device token kept in the Secret Service, the albums, an album's songs, and a player that
//! goes on through the album (README.md).

mod api;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use api::{Album, Api, ApiError, Song};
use gtk::prelude::*;
use gtk::{gio, glib};

const APP_ID: &str = "com.folk3s.echo";
/// The owner's server (as the Android app's); ECHO_URL points a test build elsewhere.
const SERVER: &str = "https://echo.folk3s.com";

fn main() -> glib::ExitCode {
    gst::init().expect("GStreamer could not start");
    let app = gtk::Application::builder().application_id(APP_ID).build();
    app.connect_activate(build);
    app.run()
}

// ---- the device token, in the Secret Service (GNOME Keyring, KWallet) ------------------------

fn schema() -> libsecret::Schema {
    libsecret::Schema::new(
        APP_ID,
        libsecret::SchemaFlags::NONE,
        HashMap::from([("server", libsecret::SchemaAttributeType::String)]),
    )
}

fn saved_token(server: &str) -> Option<String> {
    let attrs = HashMap::from([("server", server)]);
    libsecret::password_lookup_sync(Some(&schema()), attrs, gio::Cancellable::NONE)
        .ok()
        .flatten()
        .map(|s| s.to_string())
}

/// Without a Secret Service the token lives as long as the window: signing in again is the cost.
fn save_token(server: &str, token: &str) {
    let attrs = HashMap::from([("server", server)]);
    let label = "ECHO device token";
    if let Err(e) = libsecret::password_store_sync(
        Some(&schema()),
        attrs,
        Some(libsecret::COLLECTION_DEFAULT),
        label,
        token,
        gio::Cancellable::NONE,
    ) {
        eprintln!("echo: the token is not kept between runs: {e}");
    }
}

fn forget_token(server: &str) {
    let attrs = HashMap::from([("server", server)]);
    let _ = libsecret::password_clear_sync(Some(&schema()), attrs, gio::Cancellable::NONE);
}

// ---- the window ------------------------------------------------------------------------------

enum Event {
    Ended,
    Failed(String),
}

struct Ui {
    api: Api,
    token: RefCell<Option<String>>,
    albums: RefCell<Vec<Album>>,
    shown: RefCell<Vec<Song>>,
    queue: RefCell<Vec<Song>>,
    current: Cell<usize>,
    playing: Cell<bool>,
    play: gst_play::Play,
    _signals: gst_play::PlaySignalAdapter,
    window: gtk::ApplicationWindow,
    stack: gtk::Stack,
    back: gtk::Button,
    sign_out: gtk::Button,
    status: gtk::Label,
    message: gtk::Label,
    album_list: gtk::ListBox,
    song_list: gtk::ListBox,
    bar: gtk::Box,
    now: gtk::Label,
    time: gtk::Label,
    toggle: gtk::Button,
}

/// Work off the window's thread, its answer back on it.
fn background<T: Send + 'static>(
    work: impl FnOnce() -> T + Send + 'static,
    done: impl FnOnce(T) + 'static,
) {
    glib::spawn_future_local(async move {
        if let Ok(v) = gio::spawn_blocking(work).await {
            done(v);
        }
    });
}

fn mmss(s: u64) -> String {
    format!("{}:{:02}", s / 60, s % 60)
}

fn scrolled(child: &impl IsA<gtk::Widget>) -> gtk::ScrolledWindow {
    gtk::ScrolledWindow::builder()
        .vexpand(true)
        .child(child)
        .build()
}

/// A list row: the title, bold, over a dimmer line.
fn row(title: &str, sub: &str) -> gtk::Box {
    let b = gtk::Box::new(gtk::Orientation::Vertical, 2);
    b.set_margin_top(8);
    b.set_margin_bottom(8);
    b.set_margin_start(12);
    b.set_margin_end(12);
    let t = gtk::Label::new(None);
    t.set_markup(&format!("<b>{}</b>", glib::markup_escape_text(title)));
    t.set_xalign(0.0);
    let s = gtk::Label::new(Some(sub));
    s.set_xalign(0.0);
    s.add_css_class("dim-label");
    b.append(&t);
    b.append(&s);
    b
}

fn build(app: &gtk::Application) {
    let server = std::env::var("ECHO_URL").unwrap_or_else(|_| SERVER.into());
    let window = gtk::ApplicationWindow::builder()
        .application(app)
        .title("ECHO")
        .default_width(960)
        .default_height(680)
        .build();

    let header = gtk::HeaderBar::new();
    let back = gtk::Button::from_icon_name("go-previous-symbolic");
    back.set_tooltip_text(Some("Albums"));
    let sign_out = gtk::Button::with_label("Sign out");
    header.pack_start(&back);
    header.pack_end(&sign_out);
    window.set_titlebar(Some(&header));

    // Sign in: the server's device token, the code in the same request when two-factor is on.
    let user = gtk::Entry::builder().placeholder_text("Username").build();
    let pass = gtk::PasswordEntry::builder()
        .placeholder_text("Password")
        .show_peek_icon(true)
        .build();
    let code = gtk::Entry::builder()
        .placeholder_text("Authenticator code, if you use two-factor")
        .input_purpose(gtk::InputPurpose::Digits)
        .build();
    let go = gtk::Button::with_label("Sign in");
    go.add_css_class("suggested-action");
    let message = gtk::Label::new(None);
    message.set_wrap(true);
    let heading = gtk::Label::new(None);
    heading.set_markup("<big><b>Sign in to ECHO</b></big>");
    let at = gtk::Label::new(Some(&server));
    at.add_css_class("dim-label");
    let form = gtk::Box::new(gtk::Orientation::Vertical, 12);
    form.set_halign(gtk::Align::Center);
    form.set_valign(gtk::Align::Center);
    form.set_width_request(340);
    for w in [
        heading.upcast_ref::<gtk::Widget>(),
        at.upcast_ref(),
        user.upcast_ref(),
        pass.upcast_ref(),
        code.upcast_ref(),
        go.upcast_ref(),
        message.upcast_ref(),
    ] {
        form.append(w);
    }

    let album_list = gtk::ListBox::new();
    let song_list = gtk::ListBox::new();
    let stack = gtk::Stack::new(); // no page animation: lighter on a slow computer
    stack.add_named(&form, Some("signin"));
    stack.add_named(&scrolled(&album_list), Some("albums"));
    stack.add_named(&scrolled(&song_list), Some("album"));

    let status = gtk::Label::new(None);
    status.set_visible(false);
    status.set_margin_top(6);
    status.set_margin_bottom(6);

    let now = gtk::Label::new(None);
    now.set_hexpand(true);
    now.set_xalign(0.0);
    now.set_ellipsize(gtk::pango::EllipsizeMode::End);
    let time = gtk::Label::new(None);
    time.add_css_class("dim-label");
    let toggle = gtk::Button::from_icon_name("media-playback-pause-symbolic");
    toggle.set_tooltip_text(Some("Play or pause"));
    let bar = gtk::Box::new(gtk::Orientation::Horizontal, 12);
    bar.set_margin_top(8);
    bar.set_margin_bottom(8);
    bar.set_margin_start(12);
    bar.set_margin_end(12);
    bar.append(&now);
    bar.append(&time);
    bar.append(&toggle);
    bar.set_visible(false);

    let root = gtk::Box::new(gtk::Orientation::Vertical, 0);
    root.append(&status);
    root.append(&stack);
    root.append(&gtk::Separator::new(gtk::Orientation::Horizontal));
    root.append(&bar);
    window.set_child(Some(&root));

    // The player: GStreamer plays what Navidrome holds as it is. Its events come back to this
    // thread through a channel (the adapter's callbacks must be Send).
    let play = gst_play::Play::new(None::<gst_play::PlayVideoRenderer>);
    if let Ok(desc) = std::env::var("ECHO_AUDIO_SINK") {
        // Testing on a machine without a sound card: ECHO_AUDIO_SINK="fakesink sync=true".
        if let Ok(sink) = gst::parse::launch(&desc) {
            play.pipeline().set_property("audio-sink", &sink);
        }
    }
    let signals = gst_play::PlaySignalAdapter::new(&play);
    let (tx, rx) = async_channel::unbounded::<Event>();
    let ended = tx.clone();
    signals.connect_end_of_stream(move |_| {
        let _ = ended.send_blocking(Event::Ended);
    });
    signals.connect_error(move |_, err, _| {
        let _ = tx.send_blocking(Event::Failed(err.to_string()));
    });

    let ui = Rc::new(Ui {
        token: RefCell::new(saved_token(&server)),
        api: Api::new(&server),
        albums: RefCell::new(Vec::new()),
        shown: RefCell::new(Vec::new()),
        queue: RefCell::new(Vec::new()),
        current: Cell::new(0),
        playing: Cell::new(false),
        play,
        _signals: signals,
        window: window.clone(),
        stack,
        back: back.clone(),
        sign_out: sign_out.clone(),
        status,
        message,
        album_list,
        song_list,
        bar,
        now,
        time,
        toggle,
    });

    {
        let ui = ui.clone();
        glib::spawn_future_local(async move {
            while let Ok(event) = rx.recv().await {
                match event {
                    Event::Ended => next(&ui),
                    Event::Failed(why) => {
                        ui.playing.set(false);
                        ui.toggle.set_icon_name("media-playback-start-symbolic");
                        show_status(&ui, &format!("This song could not play: {why}"));
                    }
                }
            }
        });
    }

    {
        let ui = ui.clone();
        go.connect_clicked(move |_| {
            let (u, p, c) = (
                user.text().to_string(),
                pass.text().to_string(),
                code.text().to_string(),
            );
            let mut name = format!("ECHO for Linux ({})", glib::host_name());
            name.truncate(64);
            let api = ui.api.clone();
            let (ui, pass, code) = (ui.clone(), pass.clone(), code.clone());
            ui.message.set_text("Signing in…");
            background(
                move || api.sign_in(&u, &p, &c, &name),
                move |r| match r {
                    Ok(token) => {
                        save_token(&ui.api.base, &token);
                        ui.token.replace(Some(token));
                        pass.set_text("");
                        code.set_text("");
                        ui.message.set_text("");
                        load_albums(&ui);
                    }
                    Err(ApiError::Unauthorized(Some(c))) if c == "totp_required" => ui
                        .message
                        .set_text("Enter the code from your authenticator app too."),
                    Err(ApiError::Unauthorized(Some(c))) if c == "bad_code" => ui
                        .message
                        .set_text("That code did not work. Try the next one."),
                    Err(ApiError::Unauthorized(_)) => {
                        ui.message.set_text("Username or password is incorrect.")
                    }
                    Err(ApiError::Failed(c)) if c == "rate_limited" => ui
                        .message
                        .set_text("Too many attempts. Wait a minute and try again."),
                    Err(e) => ui.message.set_text(&format!("ECHO did not answer: {e}")),
                },
            );
        });
    }

    {
        let ui = ui.clone();
        ui.album_list.clone().connect_row_activated(move |_, row| {
            let album = ui.albums.borrow().get(row.index() as usize).cloned();
            if let Some(a) = album {
                open_album(&ui, a);
            }
        });
    }
    {
        let ui = ui.clone();
        ui.song_list.clone().connect_row_activated(move |_, row| {
            ui.queue.replace(ui.shown.borrow().clone());
            play_at(&ui, row.index() as usize);
        });
    }
    {
        let ui = ui.clone();
        back.connect_clicked(move |_| show_albums(&ui));
    }
    {
        let ui = ui.clone();
        sign_out.connect_clicked(move |_| {
            if let Some(token) = ui.token.borrow().clone() {
                let api = ui.api.clone();
                background(move || api.sign_out(&token), |_| ());
            }
            signed_out(&ui, "");
        });
    }
    {
        let ui = ui.clone();
        ui.toggle.clone().connect_clicked(move |_| {
            if ui.playing.get() {
                ui.play.pause();
                ui.toggle.set_icon_name("media-playback-start-symbolic");
            } else {
                ui.play.play();
                ui.toggle.set_icon_name("media-playback-pause-symbolic");
            }
            ui.playing.set(!ui.playing.get());
        });
    }
    {
        let ui = ui.clone();
        glib::timeout_add_seconds_local(1, move || {
            if ui.playing.get() {
                let at = ui.play.position().map(|t| t.seconds()).unwrap_or(0);
                let of = ui
                    .queue
                    .borrow()
                    .get(ui.current.get())
                    .map(|s| s.seconds)
                    .unwrap_or(0);
                ui.time.set_text(&format!("{} / {}", mmss(at), mmss(of)));
            }
            glib::ControlFlow::Continue
        });
    }

    if ui.token.borrow().is_some() {
        load_albums(&ui);
    } else {
        signed_out(&ui, "");
    }
    window.present();
}

fn show_status(ui: &Ui, text: &str) {
    ui.status.set_text(text);
    ui.status.set_visible(!text.is_empty());
}

/// Signed out here, or the server refused the token (revoked in Sessions & devices, or idle 60 days).
fn signed_out(ui: &Rc<Ui>, why: &str) {
    forget_token(&ui.api.base);
    ui.token.replace(None);
    ui.play.stop();
    ui.playing.set(false);
    ui.bar.set_visible(false);
    ui.back.set_visible(false);
    ui.sign_out.set_visible(false);
    ui.message.set_text(why);
    show_status(ui, "");
    ui.window.set_title(Some("ECHO"));
    ui.stack.set_visible_child_name("signin");
}

fn failed(ui: &Rc<Ui>, e: ApiError) {
    match e {
        ApiError::Unauthorized(_) => signed_out(ui, "Signed out. Sign in again."),
        ApiError::Failed(why) => show_status(ui, &format!("ECHO did not answer: {why}")),
    }
}

fn token(ui: &Rc<Ui>) -> Option<String> {
    let t = ui.token.borrow().clone();
    if t.is_none() {
        signed_out(ui, "");
    }
    t
}

fn show_albums(ui: &Rc<Ui>) {
    ui.back.set_visible(false);
    ui.sign_out.set_visible(true);
    ui.window.set_title(Some("ECHO"));
    ui.stack.set_visible_child_name("albums");
}

fn load_albums(ui: &Rc<Ui>) {
    let Some(token) = token(ui) else { return };
    show_albums(ui);
    show_status(ui, "Loading your albums…");
    let api = ui.api.clone();
    let ui = ui.clone();
    background(
        move || api.albums(&token),
        move |r| match r {
            Ok(albums) => {
                show_status(
                    &ui,
                    if albums.is_empty() {
                        "No albums yet: connect Navidrome in ECHO's Settings."
                    } else {
                        ""
                    },
                );
                ui.album_list.remove_all();
                for a in &albums {
                    ui.album_list.append(&row(&a.name, &a.artist));
                }
                ui.albums.replace(albums);
            }
            Err(e) => failed(&ui, e),
        },
    );
}

fn open_album(ui: &Rc<Ui>, album: Album) {
    let Some(token) = token(ui) else { return };
    let api = ui.api.clone();
    let ui = ui.clone();
    background(
        move || api.songs(&token, &album.id),
        move |r| match r {
            Ok(songs) => {
                ui.song_list.remove_all();
                for (i, s) in songs.iter().enumerate() {
                    ui.song_list.append(&row(
                        &format!("{}. {}", i + 1, s.title),
                        &format!("{} · {}", s.artist, mmss(s.seconds)),
                    ));
                }
                ui.shown.replace(songs);
                ui.back.set_visible(true);
                ui.window.set_title(Some(&album.name));
                ui.stack.set_visible_child_name("album");
            }
            Err(e) => failed(&ui, e),
        },
    );
}

fn play_at(ui: &Rc<Ui>, index: usize) {
    let Some(song) = ui.queue.borrow().get(index).cloned() else {
        return;
    };
    let Some(token) = token(ui) else { return };
    ui.current.set(index);
    ui.now
        .set_text(&format!("{} — {}", song.title, song.artist));
    ui.time.set_text(&format!("0:00 / {}", mmss(song.seconds)));
    ui.bar.set_visible(true);
    show_status(ui, "");
    let api = ui.api.clone();
    let ui = ui.clone();
    background(
        move || api.stream_url(&token, &song.id),
        move |r| match r {
            // A newer tap won meanwhile: this answer is stale.
            Ok(_) if ui.current.get() != index => {}
            Ok(url) => {
                ui.play.set_uri(Some(&url));
                ui.play.play();
                ui.playing.set(true);
                ui.toggle.set_icon_name("media-playback-pause-symbolic");
            }
            Err(e) => failed(&ui, e),
        },
    );
}

/// The album goes on; after its last song the player stops.
fn next(ui: &Rc<Ui>) {
    let i = ui.current.get() + 1;
    if i < ui.queue.borrow().len() {
        play_at(ui, i);
    } else {
        ui.playing.set(false);
        ui.toggle.set_icon_name("media-playback-start-symbolic");
    }
}
