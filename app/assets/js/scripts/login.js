/**
 * Script for login.ejs
 */
// Validation Regexes.
const validUsername         = /^[a-zA-Z0-9_]{1,16}$/
const basicEmail            = /^\S+@\S+\.\S+$/

// Login Elements
const loginCancelContainer  = document.getElementById('loginCancelContainer')
const loginCancelButton     = document.getElementById('loginCancelButton')
const loginEmailError       = document.getElementById('loginEmailError')
const loginUsername         = document.getElementById('loginUsername')
const checkmarkContainer    = document.getElementById('checkmarkContainer')
const loginRememberOption   = document.getElementById('loginRememberOption')
const loginButton           = document.getElementById('loginButton')
const loginForm             = document.getElementById('loginForm')

// Control variable.
let lu = false;

/**
 * Show a login error.
 * 
 * @param {HTMLElement} element The element on which to display the error.
 * @param {string} value The error text.
 */
function showError(element, value){
    element.innerHTML = value;
    element.style.opacity = 1;
}

/**
 * Shake a login error to add emphasis.
 * 
 * @param {HTMLElement} element The element to shake.
 */
function shakeError(element){
    if(element.style.opacity == 1){
        element.classList.remove('shake');
        void element.offsetWidth;
        element.classList.add('shake');
    }
}

/**
 * Validate that an email field is neither empty nor invalid.
 * 
 * @param {string} value The email value.
 */
function validateEmail(value) {
    if (value.length >= 4) {
        loginEmailError.style.opacity = 0;
        lu = true;
    } else {
        showError(loginEmailError, Lang.queryJS('login.error.invalidValue'));
        lu = false;
    }

    checkLoginButtonEnabled(); // Chamada da função para habilitar/desabilitar o botão de login.
}

// Função para habilitar/desabilitar o botão de login quando ambos os campos estiverem preenchidos.
function checkLoginButtonEnabled() {
    loginButton.disabled = !lu;
}

// Emphasize errors with shake when focus is lost.
loginUsername.addEventListener('focusout', (e) => {
    validateEmail(e.target.value);
    shakeError(loginEmailError);
});

// Validate input for email field.
loginUsername.addEventListener('input', (e) => {
    validateEmail(e.target.value);
});

/**
 * Enable or disable loading elements.
 * 
 * @param {boolean} v True to enable, false to disable.
 */
function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v);
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.login'), Lang.queryJS('login.loggingIn'));
    } else {
        loginButton.removeAttribute('loading');
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.login'));
    }
}

/**
 * Enable or disable login form.
 * 
 * @param {boolean} v True to enable, false to disable.
 */
function formDisabled(v){
    loginCancelButton.disabled = v;
    loginUsername.disabled = v;
    if(v){
        checkmarkContainer.setAttribute('disabled', v);
    } else {
        checkmarkContainer.removeAttribute('disabled');
    }
    loginRememberOption.disabled = v;
}

let loginViewOnSuccess = VIEWS.landing;
let loginViewOnCancel = VIEWS.settings;
let loginViewCancelHandler;

function loginCancelEnabled(val){
    if(val){
        $(loginCancelContainer).show();
    } else {
        $(loginCancelContainer).hide();
    }
}

loginCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
        loginUsername.value = '';
        loginCancelEnabled(false);
        if(loginViewCancelHandler != null){
            loginViewCancelHandler();
            loginViewCancelHandler = null;
        }
    });
};

// Disable default form behavior.
loginForm.onsubmit = () => { return false; };

// Bind login button behavior.
loginButton.addEventListener('click', () => {
    // Disable form.
    formDisabled(true);

    // Show loading stuff.
    loginLoading(true);

    AuthManager.addAccount(loginUsername.value).then((value) => { // Apenas passa o nome de usuário
        updateSelectedAccount(value);
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'));
        $('.circle-loader').toggleClass('load-complete');
        $('.checkmark').toggle();
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                // Temporary workaround
                if(loginViewOnSuccess === VIEWS.settings){
                    await prepareSettings();
                }
                loginViewOnSuccess = VIEWS.landing; // Reset this for good measure.
                loginCancelEnabled(false); // Reset this for good measure.
                loginViewCancelHandler = null; // Reset this for good measure.
                loginUsername.value = '';
                $('.circle-loader').toggleClass('load-complete');
                $('.checkmark').toggle();
                loginLoading(false);
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'));
                formDisabled(false);
            });
        }, 1000);
    }).catch((displayableError) => {
        loginLoading(false);

        let actualDisplayableError;
        if(isDisplayableError(displayableError)) {
            msftLoginLogger.error('Error while logging in.', displayableError);
            actualDisplayableError = displayableError;
        } else {
            // Uh oh.
            msftLoginLogger.error('Unhandled error during login.', displayableError);
            actualDisplayableError = Lang.queryJS('login.error.unknown');
        }

        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'));
        setOverlayHandler(() => {
            formDisabled(false);
            toggleOverlay(false);
        });
        toggleOverlay(true);
    });
});


