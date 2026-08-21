/* Shared Waggle chat engine for both /Waggle and the widget; conversation per tab, adopted pets shared. */
(function () {
    'use strict';

    var HISTORY_KEY = 'waggle.chat.history.v1';
    var OPEN_KEY = 'waggle.chat.open.v1';
    var TEASER_KEY = 'waggle.chat.teaserSeen.v1';
    var SIZE_KEY = 'waggle.chat.size.v1';
    var ADOPTED_KEY = 'waggle.chat.adopted.v1';

    var IMAGE_URL_RE = /\.(?:jpe?g|png|gif|webp|avif)(?:\?[^\s)]*)?$/i;

    // ---------- pet identity ----------

    // The CDN path is the one reliable signal for what a photo is: /puppies/, /kittens/, /bunnies/, /petfood/.
    var URL_PET_TYPE = { puppies: 'puppy', kittens: 'kitten', bunnies: 'bunny' };

    // The models are inconsistent about alt text — observed: "puppy", "Puppy 001", "007 puppy" — so accept
    // the id on either side of the type, and fall back to the id in the line that introduces the photo:
    // "- **#004** - Black, Cuteness 5/5, $89 - ![puppy](.../p11.jpg)".
    var ALT_ID_FIRST_RE = /^(?:pet\s*)?#?\s*([0-9]{1,6}|[A-Za-z0-9][\w.-]{0,15})\s+(?:puppy|kitten|bunny)$/i;
    var ALT_ID_LAST_RE = /^(?:pet\s*)?(?:puppy|kitten|bunny)\s*#?\s*([0-9]{1,6}|[A-Za-z0-9][\w.-]{0,15})$/i;
    var TEXT_ID_RE = /(?:pet\s*id\b\W{0,4}|#)\s*([0-9]{1,6})/gi;

    function petTypeFromUrl(url) {
        var match = url.match(/\/(puppies|kittens|bunnies)\//i);
        return match ? URL_PET_TYPE[match[1].toLowerCase()] : '';
    }

    // The last id mentioned before the photo on its own line is the pet the photo belongs to.
    function petIdFromText(text) {
        var last = '';
        var match;
        TEXT_ID_RE.lastIndex = 0;
        while ((match = TEXT_ID_RE.exec(text)) !== null) last = match[1];
        return last;
    }

    function petIdFromAlt(alt) {
        var byIdFirst = alt.match(ALT_ID_FIRST_RE);
        if (byIdFirst) return byIdFirst[1];
        var byIdLast = alt.match(ALT_ID_LAST_RE);
        return byIdLast ? byIdLast[1] : '';
    }

    // Text on the photo's own line, which is where a list item states the pet id. Messages arrive with
    // real newlines or a literal backslash-n, so both end a line here.
    function lineBefore(text, offset) {
        var newline = text.lastIndexOf('\n', offset);
        var literal = text.lastIndexOf('\\n', offset);
        return text.slice(Math.max(newline + 1, literal < 0 ? 0 : literal + 2), offset);
    }

    // ---------- adopted pets ----------

    // A pet can only be adopted once, so its card must stop offering "Adopt" the moment the
    // agent confirms — including the card in the confirmation itself and any earlier listing.
    var ADOPTION_DONE_RE = new RegExp(
        ['adoption confirmed', 'adoption (?:is )?complete',
            'successfully adopted', 'you(?:\'ve| have) (?:now )?adopted'].join('|'), 'i');

    // localStorage, not sessionStorage: a pet being adopted is a fact about the store, not about one
    // tab's conversation, so every tab (and a later visit) must agree on it.
    var adopted = loadAdopted();

    function loadAdopted() {
        try {
            return JSON.parse(localStorage.getItem(ADOPTED_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function isAdopted(petId, url) {
        return !!(adopted['url:' + url] || (petId && adopted['id:' + String(petId).toLowerCase()]));
    }

    // Record what a confirmation message says was adopted: its pet id, and its photo URL, because
    // the confirmation often inlines a bare URL that carries no id of its own.
    function noteAdoption(text) {
        var found = {};
        var match;
        var ids = /pet\s*id\b\W{0,4}([A-Za-z0-9][\w.-]{0,31})/gi;
        while ((match = ids.exec(text)) !== null) found['id:' + match[1].toLowerCase()] = 1;
        var urls = /https?:\/\/[^\s<>")\]]+/g;
        while ((match = urls.exec(text)) !== null) {
            if (IMAGE_URL_RE.test(match[0]) && !/\/petfood\//i.test(match[0])) found['url:' + match[0]] = 1;
        }

        var added = false;
        for (var key in found) {
            if (!adopted[key]) { adopted[key] = 1; added = true; }
        }
        if (!added) return;
        try {
            localStorage.setItem(ADOPTED_KEY, JSON.stringify(adopted));
        } catch (e) { /* quota or private mode: in-memory state still works for this page */ }
        retireAdoptedCards();
    }

    // Another tab (or the other chat on this page) confirmed an adoption: adopt a pet in the widget
    // and the cards on the full Waggle page behind it must agree without a reload.
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('storage', function (event) {
            if (event.key && event.key !== ADOPTED_KEY) return;
            adopted = loadAdopted();
            retireAdoptedCards();
        });
    }

    // Cards rendered before the confirmation are already in the DOM, so downgrade them in place.
    function retireAdoptedCards() {
        var cards = document.querySelectorAll('.pet-card');
        for (var i = 0; i < cards.length; i++) {
            var img = cards[i].querySelector('img.pet-photo');
            var actions = cards[i].querySelector('.pet-actions');
            if (!img || !actions || !actions.querySelector('.pet-btn-adopt')) continue;
            if (cards[i].hasAttribute('data-food')) continue;
            if (isAdopted(cards[i].getAttribute('data-petid'), img.src)) actions.innerHTML = adoptedHtml();
        }
    }

    function adoptedHtml() {
        return '<span class="pet-btn pet-btn-done" aria-disabled="true">&#10003; Adopted</span>';
    }

    // ---------- formatting ----------

    function escAttr(value) {
        return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // A photo becomes a card; the CDN path (/petfood/ vs /kittens|/puppies|/bunnies) picks the actions.
    // `context` is the text introducing the photo, used to recover a pet id the alt text omits, so the
    // card can name the pet instead of pasting a CDN URL into the chat.
    function imageHtml(url, alt, context) {
        var safeUrl = escAttr(url);
        var isFood = /\/petfood\//i.test(url);
        var label = String(alt || '').trim();
        var petType = isFood ? '' : petTypeFromUrl(url);
        // Only claim an id when the URL proves this is a pet, so a stray "#5" elsewhere can't invent one.
        var petId = petType ? (petIdFromAlt(label) || petIdFromText(context || '')) : '';

        var data = '';
        if (isFood && label) {
            data = ' data-food="' + escAttr(label) + '"';
        } else if (petId) {
            data = ' data-petid="' + escAttr(petId) + '"';
            if (petType) data += ' data-pettype="' + escAttr(petType) + '"';
        }

        var actions;
        if (isFood) {
            actions = '<button type="button" class="pet-btn pet-btn-adopt"' +
                ' onclick="addFoodToCart(this)">Add to cart</button>' +
                '<button type="button" class="pet-btn pet-btn-buy" onclick="buyFood(this)">Buy now</button>';
        } else if (isAdopted(petId, url)) {
            actions = adoptedHtml();
        } else {
            actions = '<button type="button" class="pet-btn pet-btn-adopt" onclick="adoptPet(this)">Adopt</button>';
        }

        var altText = escAttr(label || (isFood ? 'pet food' : 'pet photo'));
        return '<span class="pet-card"' + data + '>' +
            '<img class="pet-photo" src="' + safeUrl + '" alt="' + altText + '"' +
            ' loading="lazy" title="Click to view full size"' +
            ' onerror="this.closest(\'.pet-card\').style.display=\'none\'"' +
            ' onclick="window.open(this.src,\'_blank\')">' +
            '<span class="pet-actions">' + actions + '</span></span>';
    }

    function linkHtml(url, text) {
        return '<a href="' + escAttr(url) + '" target="_blank" rel="noopener noreferrer"' +
            ' class="wg-link">' + escAttr(text || url) + '</a>';
    }

    // Only agent messages reach here (user text is rendered as textContent), so an adoption
    // confirmation is recorded before the cards below are built and can render as "Adopted".
    function formatMessage(message) {
        if (ADOPTION_DONE_RE.test(String(message))) noteAdoption(String(message));

        // Links/images first, stashed behind placeholders, so the regexes below can't mangle URLs.
        var held = [];
        var hold = function (html) { return '\u0001H' + (held.push(html) - 1) + '\u0001'; };

        var formatted = String(message)
            .replace(/!?\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, function (m, text, url, offset, whole) {
                if (!IMAGE_URL_RE.test(url)) return hold(linkHtml(url, text));
                return hold(imageHtml(url, text, lineBefore(whole, offset)));
            })
            .replace(/(^|[\s(])(https?:\/\/[^\s<>")\]]+)/g, function (m, pre, url, offset, whole) {
                if (!IMAGE_URL_RE.test(url)) return pre + hold(linkHtml(url, url));
                return pre + hold(imageHtml(url, '', lineBefore(whole, offset)));
            });

        formatted = formatted.replace(/\\n/g, '<br>').replace(/\n/g, '<br>');

        // Match after <br> too, not just ^: newlines are already converted, so ^ hit only line one.
        formatted = formatted
            .replace(/(^|<br>)### (.*?)(?=<br>|$)/g, '$1<h5 class="wg-h5">$2</h5>')
            .replace(/(^|<br>)## (.*?)(?=<br>|$)/g, '$1<h4 class="wg-h4">$2</h4>')
            .replace(/(^|<br>)# (.*?)(?=<br>|$)/g, '$1<h3 class="wg-h3">$2</h3>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
            .replace(/(^|<br>)(\d+)\. (.*?)(?=<br>|$)/g,
                '$1<div class="wg-li wg-li-num"><span class="wg-li-marker">$2.</span> $3</div>')
            .replace(/(^|<br>)[-*] (.*?)(?=<br>|$)/g,
                '$1<div class="wg-li"><span class="wg-li-marker">&bull;</span> $2</div>')
            // '$$' is a literal $ in a replacement, so the amount needs '$$$1'; '$$1' gave a bare "$1".
            .replace(/\$(\d+(?:\.\d{2})?)/g, '<span class="wg-price">$$$1</span>')
            .replace(/  /g, '&nbsp;&nbsp;');

        // Put the stashed link/image HTML back, after all text formatting.
        return formatted.replace(/\u0001H(\d+)\u0001/g, function (m, i) { return held[Number(i)]; });
    }

    // ---------- persistence (per tab, survives page navigation) ----------

    function loadState() {
        try {
            return JSON.parse(sessionStorage.getItem(HISTORY_KEY)) || { sessionId: null, messages: [] };
        } catch (e) {
            return { sessionId: null, messages: [] };
        }
    }

    function saveState(state) {
        try { sessionStorage.setItem(HISTORY_KEY, JSON.stringify(state)); } catch (e) { /* quota / private mode */ }
    }

    function clearState() {
        try { sessionStorage.removeItem(HISTORY_KEY); } catch (e) { /* ignore */ }
    }

    // ---------- instances ----------

    var instances = [];

    function instanceFor(element) {
        for (var i = 0; i < instances.length; i++) {
            if (instances[i].messagesEl.contains(element)) return instances[i];
        }
        return instances[0] || null;
    }

    function create(options) {
        var messagesEl = options.messagesEl;
        var inputEl = options.inputEl;
        var sendButtonEl = options.sendButtonEl;
        var sessionLabelEl = options.sessionLabelEl || null;
        var userId = options.userId || '';
        var welcome = options.welcome || '';

        var state = loadState();
        var isProcessing = false;

        function setBusy(busy) {
            isProcessing = busy;
            if (sendButtonEl) {
                sendButtonEl.disabled = busy;
                var icon = sendButtonEl.querySelector('.send-icon');
                var spinner = sendButtonEl.querySelector('.spinner');
                if (icon) icon.style.display = busy ? 'none' : 'block';
                if (spinner) spinner.style.display = busy ? 'block' : 'none';
            }
        }

        function showSessionId() {
            if (sessionLabelEl && state.sessionId) {
                sessionLabelEl.textContent = 'Session ID: ' + state.sessionId;
                sessionLabelEl.setAttribute('title', state.sessionId);
            }
        }

        function scroll() { messagesEl.scrollTop = messagesEl.scrollHeight; }

        function renderMessage(text, isUser, animate) {
            var wrap = document.createElement('div');
            wrap.className = 'message ' + (isUser ? 'user-message' : 'bot-message');
            if (animate) wrap.className += isUser ? ' animate-in-user' : ' animate-in';

            var sender = document.createElement('div');
            sender.className = 'sender-name';
            sender.textContent = isUser ? 'You' : 'Waggle';

            var bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            if (isUser) { bubble.textContent = text; } else { bubble.innerHTML = formatMessage(text); }

            var stamp = document.createElement('div');
            stamp.className = 'timestamp';
            stamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            bubble.appendChild(stamp);
            wrap.appendChild(sender);
            wrap.appendChild(bubble);
            messagesEl.appendChild(wrap);
            scroll();
            return bubble;
        }

        function addMessage(text, isUser, options2) {
            var opts = options2 || {};
            renderMessage(text, isUser, opts.animate !== false);
            if (opts.persist !== false) {
                state.messages.push({ r: isUser ? 'u' : 'b', t: text });
                saveState(state);
            }
        }

        function addThinking() {
            var wrap = document.createElement('div');
            wrap.className = 'message bot-message animate-in';
            var sender = document.createElement('div');
            sender.className = 'sender-name';
            sender.textContent = 'Waggle';
            var bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            bubble.innerHTML = '<div class="thinking-message"><span class="paw">&#128062;</span>' +
                '<span class="paw">&#128062;</span><span class="paw">&#128062;</span>' +
                '<span class="tail">&#129460;</span></div>';
            wrap.appendChild(sender);
            wrap.appendChild(bubble);
            messagesEl.appendChild(wrap);
            scroll();
            return wrap;
        }

        function createBotBubble() {
            var wrap = document.createElement('div');
            wrap.className = 'message bot-message';
            var sender = document.createElement('div');
            sender.className = 'sender-name';
            sender.textContent = 'Waggle';
            var bubble = document.createElement('div');
            bubble.className = 'message-bubble';
            wrap.appendChild(sender);
            wrap.appendChild(bubble);
            messagesEl.appendChild(wrap);
            scroll();
            return bubble;
        }

        function appendTimestamp(bubble) {
            var stamp = document.createElement('div');
            stamp.className = 'timestamp';
            stamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            bubble.appendChild(stamp);
        }

        async function send(text) {
            var message = (text !== undefined ? text : inputEl.value).trim();
            if (!message || isProcessing) return;

            setBusy(true);
            addMessage(message, true);
            inputEl.value = '';

            var thinking = addThinking();
            if (typeof options.onSend === 'function') options.onSend();

            try {
                var response = await fetch('/Waggle/SendMessage', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: message, userId: userId, sessionId: state.sessionId })
                });
                if (!response.ok || !response.body) throw new Error('HTTP ' + response.status);

                var sid = response.headers.get('X-Session-Id');
                if (sid) { state.sessionId = sid; showSessionId(); saveState(state); }

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var full = '';
                var bubble = null;

                while (true) {
                    var step = await reader.read();
                    if (step.done) break;
                    var chunk = decoder.decode(step.value, { stream: true });
                    if (!chunk) continue;
                    if (!bubble) {
                        if (thinking && thinking.parentNode) thinking.remove();
                        bubble = createBotBubble();
                    }
                    full += chunk;
                    bubble.textContent = full; // fast live plain-text render
                    scroll();
                }

                if (bubble) {
                    bubble.innerHTML = formatMessage(full);
                    appendTimestamp(bubble);
                    scroll();
                    state.messages.push({ r: 'b', t: full });
                    saveState(state);
                } else {
                    if (thinking && thinking.parentNode) thinking.remove();
                    addMessage("Sorry, I couldn't generate a response. Please try again.", false, { animate: false });
                }
            } catch (error) {
                if (thinking && thinking.parentNode) thinking.remove();
                console.error('Waggle:', error);
                addMessage('Sorry, there was an error sending your message. Please try again.', false, { animate: false });
            } finally {
                setBusy(false);
                if (options.autoFocus !== false) inputEl.focus();
            }
        }

        // Buttons send an intent naming the pet/food; the agent confirms, so one click never buys.
        function sendCardIntent(button, kind) {
            if (isProcessing) return;
            var card = button.closest('.pet-card');
            var img = card ? card.querySelector('img.pet-photo') : null;
            if (!img) return;
            var selected = messagesEl.querySelectorAll('.pet-card-selected');
            for (var i = 0; i < selected.length; i++) selected[i].classList.remove('pet-card-selected');
            card.classList.add('pet-card-selected');
            send(cardPhrase(card, img, kind));
        }

        function restore() {
            if (state.messages.length) {
                for (var i = 0; i < state.messages.length; i++) {
                    renderMessage(state.messages[i].t, state.messages[i].r === 'u', false);
                }
                showSessionId();
                return true;
            }
            if (welcome) addMessage(welcome, false, { animate: false });
            return false;
        }

        if (sendButtonEl) sendButtonEl.addEventListener('click', function () { send(); });
        inputEl.addEventListener('keypress', function (e) { if (e.key === 'Enter') send(); });

        var instance = {
            messagesEl: messagesEl,
            send: send,
            sendCardIntent: sendCardIntent,
            restore: restore,
            scrollToEnd: scroll,
            hasHistory: function () { return state.messages.length > 0; },
            hasUserMessages: function () {
                for (var i = 0; i < state.messages.length; i++) {
                    if (state.messages[i].r === 'u') return true;
                }
                return false;
            },
            reset: function () {
                state = { sessionId: null, messages: [] };
                clearState();
                messagesEl.innerHTML = '';
                if (welcome) addMessage(welcome, false, { animate: false });
            }
        };
        instances.push(instance);
        return instance;
    }

    // Name the pet id / food rather than pasting a CDN URL into the chat: it reads like something a
    // customer would type, and the agent resolves it directly instead of matching image URLs.
    function cardPhrase(card, img, kind) {
        var petId = card.getAttribute('data-petid');
        var petType = card.getAttribute('data-pettype');
        var food = card.getAttribute('data-food');

        if (kind === 'adopt') {
            if (!petId) return 'I would like to adopt the pet in this photo: ' + img.src;
            return 'I would like to adopt pet ' + petId + (petType ? ', the ' + petType : '') + '.';
        }
        if (kind === 'buy') {
            if (!food) return 'I want to buy the food in this photo. Please add it to my cart and check out: ' + img.src;
            return 'I want to buy "' + food + '". Please add it to my cart and check out.';
        }
        if (!food) return 'Please add the food in this photo to my cart: ' + img.src;
        return 'Please add "' + food + '" to my cart.';
    }

    // Inline onclick resolves in global scope, so route to whichever chat instance owns the card.
    window.adoptPet = function (button) {
        var i = instanceFor(button);
        if (i) i.sendCardIntent(button, 'adopt');
    };
    window.addFoodToCart = function (button) {
        var i = instanceFor(button);
        if (i) i.sendCardIntent(button, 'cart');
    };
    window.buyFood = function (button) {
        var i = instanceFor(button);
        if (i) i.sendCardIntent(button, 'buy');
    };

    // ---------- floating widget ----------

    // Wires _WaggleWidget.cshtml's launcher/teaser/minimize here so widget and preview share one copy.
    function mountWidget(options) {
        options = options || {};
        var root = document.getElementById('wg-root');
        if (!root) return null;

        var launcher = document.getElementById('wg-launcher');
        var panel = document.getElementById('wg-panel');
        var teaser = document.getElementById('wg-teaser');
        var teaserClose = document.getElementById('wg-teaser-close');
        var minimize = document.getElementById('wg-minimize');
        var input = document.getElementById('wg-input');
        var launcherIcon = launcher.innerHTML;

        var chat = create({
            messagesEl: document.getElementById('wg-messages'),
            inputEl: input,
            sendButtonEl: document.getElementById('wg-send'),
            sessionLabelEl: document.getElementById('wg-session'),
            userId: root.dataset.userId || options.userId || '',
            welcome: options.welcome || ''
        });

        function store(key, value) {
            try { sessionStorage.setItem(key, value); } catch (e) { /* private mode */ }
        }

        function hideTeaser() {
            if (teaser) teaser.hidden = true;
            store(TEASER_KEY, '1');
        }

        function isOpen() { return !panel.hidden; }

        function open(focus) {
            hideTeaser();
            panel.hidden = false;
            // The launcher doubles as the collapse control: expected, and a bigger target than the header button.
            launcher.innerHTML = '&#9662;';
            launcher.classList.add('wg-launcher-open');
            launcher.setAttribute('title', 'Minimize chat');
            launcher.setAttribute('aria-label', 'Minimize chat');
            store(OPEN_KEY, '1');
            if (focus !== false) input.focus();
            chat.scrollToEnd();
        }

        function close() {
            panel.hidden = true;
            launcher.innerHTML = launcherIcon;
            launcher.classList.remove('wg-launcher-open');
            launcher.setAttribute('title', 'Chat with Waggle AI');
            launcher.setAttribute('aria-label', 'Chat with Waggle AI');
            store(OPEN_KEY, '0');
        }

        // ---- resize from the top left corner; anchored bottom right, so it grows on screen ----
        var MIN_W = 320, MIN_H = 340;

        function applySize(w, h) {
            panel.style.width = w + 'px';
            panel.style.height = h + 'px';
        }

        try {
            var saved = JSON.parse(sessionStorage.getItem(SIZE_KEY) || 'null');
            if (saved && saved.w && saved.h) applySize(saved.w, saved.h);
        } catch (e) { /* ignore */ }

        var grip = document.getElementById('wg-resize');
        if (grip) {
            grip.addEventListener('pointerdown', function (e) {
                e.preventDefault();
                var rect = panel.getBoundingClientRect();
                var startX = e.clientX, startY = e.clientY, startW = rect.width, startH = rect.height;
                try { grip.setPointerCapture(e.pointerId); } catch (err) { /* no active pointer */ }

                function move(ev) {
                    var w = Math.round(startW + (startX - ev.clientX));
                    var h = Math.round(startH + (startY - ev.clientY));
                    w = Math.max(MIN_W, Math.min(w, window.innerWidth - 48));
                    h = Math.max(MIN_H, Math.min(h, window.innerHeight - 110));
                    applySize(w, h);
                }

                function up() {
                    grip.removeEventListener('pointermove', move);
                    grip.removeEventListener('pointerup', up);
                    var r = panel.getBoundingClientRect();
                    try {
                        sessionStorage.setItem(SIZE_KEY, JSON.stringify({
                            w: Math.round(r.width), h: Math.round(r.height)
                        }));
                    } catch (e2) { /* ignore */ }
                    chat.scrollToEnd();
                }

                grip.addEventListener('pointermove', move);
                grip.addEventListener('pointerup', up);
            });
        }

        // Conversation first, then open/minimized state, so page navigation resumes where it was.
        chat.restore();

        if (sessionStorage.getItem(OPEN_KEY) === '1') {
            open(false);
        } else if (!chat.hasUserMessages() && sessionStorage.getItem(TEASER_KEY) !== '1' && teaser) {
            window.setTimeout(function () { if (!isOpen()) teaser.hidden = false; }, options.teaserDelay || 2500);
        }

        launcher.addEventListener('click', function () { if (isOpen()) { close(); } else { open(); } });
        if (minimize) minimize.addEventListener('click', close);
        if (teaserClose) {
            teaserClose.addEventListener('click', function (e) { e.stopPropagation(); hideTeaser(); });
        }
        if (teaser) {
            teaser.addEventListener('click', open);
            teaser.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
            });
        }
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && isOpen()) close();
        });

        return chat;
    }

    window.WaggleChat = {
        create: create,
        mountWidget: mountWidget,
        formatMessage: formatMessage,
        keys: { history: HISTORY_KEY, open: OPEN_KEY, teaser: TEASER_KEY }
    };
})();
