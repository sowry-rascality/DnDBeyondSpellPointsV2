// ==UserScript==
// @name         DnDBeyond Spell Points (v2)
// @description  Spell point tracker
// @version      2.0.3
// @author       Mwr247
// @namespace    Mwr247
// @homepageURL  https://github.com/sowry-rascality/DnDBeyondSpellPointsV2
// @include      https://www.dndbeyond.com/*characters/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  const SPELL_POINTS_TABLE = [
    // Class Level, Sorc Points, Spell Points, Max Slot Level
    [1,0,4,1],
    [2,2,6,1],
    [3,3,14,2],
    [4,4,17,2],
    [5,5,27,3],
    [6,6,32,3],
    [7,7,38,4],
    [8,8,44,4],
    [9,9,57,5],
    [10,10,64,5],
    [11,11,73,6],
    [12,12,73,6],
    [13,13,83,7],
    [14,14,83,7],
    [15,15,94,8],
    [16,16,94,8],
    [17,17,107,9],
    [18,18,114,9],
    [19,19,123,9],
    [20,20,133,9]
  ];

  const SPELL_COST_TABLE = [
    // Spell Level, Point Cost, Limit of 1
    [1,2,false],
    [2,3,false],
    [3,5,false],
    [4,6,false],
    [5,7,false],
    [6,8,true],
    [7,10,true],
    [8,11,true],
    [9,13,true]
  ];

  class SpellPoints__Session {
    token = null;
    tokenExpires = 0;

    constructor() {
      this.getToken = this.getToken.bind(this);
      this.getData = this.getData.bind(this);
    }

    validToken() {
      return this.token != null && this.tokenExpires > Date.now();
    }

    getToken() {
      console.log('refreshing token');
      return fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', {
        method: 'POST',
        credentials: 'include'
      }).then(resp => resp.json()).then(data => {
        console.log('token updated');
        this.token = data.token;
        this.tokenExpires = Date.now() + data.ttl * 1000 - 10000;
      }).catch(error => console.error(error));
    }

    getData(path = '', obj = {}) {
      console.log('loading data');
      if (!this.validToken()) {
        return this.getToken().then(() => this._fetchData(path, obj));
      } else {
        return this._fetchData(path, obj);
      }
    }

    _buildRequestHeader(obj) {
      return Object.assign(obj.headers || {}, {'Content-type': 'application/json;charset=utf-8', 'Authorization': 'Bearer ' + this.token})
    }

    _fetchData(path, obj) {
      obj.headers = this._buildRequestHeader(obj);
      if (obj.body) {obj.body = JSON.stringify(obj.body);}
      return fetch('https://character-service.dndbeyond.com/character/v5/' + path, obj).then(resp => resp.json()).then(data => data.data).catch(error => console.error(error));
    }
  }

  class SpellPoints__System {
    loaded = 10;
    spSystem = null;
    useSpellPoints = null;
    mergeSorcPoints = null;
    _session = null;

    constructor(session) {
      this._session = session

      this.init = this.init.bind(this);
      this.setLoaded = this.setLoaded.bind(this);
      this.getData = this.getData.bind(this);
    }

    init(spSystem) {
      this.spSystem = spSystem;
      this.useSpellPoints = spSystem?.isProficient === true;
      this.mergeSorcPoints = spSystem?.isMartialArts === true;
    }

    setLoaded() {
      this.loaded = 0;
    }

    getData(path = '', obj = {}) {
      return this._session.getData(path, obj);
    }
  }

  class SpellPoints__Player {
    id = location.pathname.split('/characters/')[1].split('/')[0];
    level = null;
    points = 0;
    maxPoints = 0;
    maxSpellLevel = 0;
    data = null;
    _session = null;
    _system = null;

    constructor() {
      this._session = new SpellPoints__Session();
      this._system = new SpellPoints__System(this._session);

      this.session = this.session.bind(this);
      this.system = this.system.bind(this);
      this.spendPoints = this.spendPoints.bind(this);
      this.setPoints = this.setPoints.bind(this);
      this.recoverPoints = this.recoverPoints.bind(this);
      this.loadCharacter = this.loadCharacter.bind(this);
    }

    session() {
      return this._session;
    }

    system() {
      return this._system;
    }

    loadCharacter() {
      return this._session.getData('character/' + player.id, {}).then((data) => {
        this.data = data;
        // Load the spell point system.
        let spSystem = (data?.customActions || []).find(act => act.name === 'Spell Points');
        this._system.init(spSystem);
        // Calculate level and spell points.
        this._setCasterLevel(); // Order is important. We need caster level first.
      	this._setMaxSpellPoints(); // Set max Spell points second (as spell points needs it).
        this._setSpellPoints();
      });
    }

    spendPoints(cost) {
      if (this.points >= cost) {
        this._updatePoints(this.points - cost);
        return true;
      } else {
        return false;
      }
    }

    setPoints(val) {
      if (val < 0) return false;
      this._updatePoints(val);
      return true;
    }

    recoverPoints(cost) {
      return this.setPoints(this.points + cost);
    }

    _updatePoints(val) {
      val = Math.max(Math.min(val, this.maxPoints), 0);
      this.points = val;
      const tmp = Object.assign(this._system.spSystem, {characterId: + this.id, fixedValue: (this.maxPoints - this.points) || null});
      this._session.getData('custom/action', {method: 'PUT', body: tmp}).then((data) => {
        this._system.spSystem.fixedValue = tmp.fixedValue;
      });
    }

    _setCasterLevel() {
      let classesWithLevels = this.data.classes.map(cl => {
        const isCaster = (cl.definition.canCastSpells == true || cl.subclassDefinition?.canCastSpells == true) && cl.definition.id !== 7;
        const level = cl.level || 1;
        const divisor = cl.definition.spellRules?.multiClassSpellSlotDivisor || cl.subclassDefinition?.spellRules?.multiClassSpellSlotDivisor || 1;
        const rounder = cl.definition.spellRules?.multiClassSpellSlotRounding || cl.subclassDefinition?.spellRules?.multiClassSpellSlotRounding || 1;
        return isCaster * Math[rounder === 1 ? 'floor' : 'ceil'](level / divisor);
      });
      this.level = classesWithLevels.reduce((a, b) => a + b, 0) || 1;
    }

    _setSpellPoints() {
      this.points = Math.max(this.maxPoints - (this._system.spSystem?.fixedValue || 0) * 1, 0)
    }

    _setMaxSpellPoints() {
      const sorcPoints = (((this.data?.actions?.class || []).find(act => act?.id === '1031') || {}).limitedUse?.maxUses +
          (this.data?.feats || []).some(feat => feat?.definition?.id === 452833) * 2) || 0;
      this.maxPoints = sorcPoints * this._system.mergeSorcPoints + SPELL_POINTS_TABLE[this.level - 1][2];
    }

    _setMaxSpellLevel() {
      this.maxSpellLevel = SPELL_POINTS_TABLE[this.level - 1][3];
    }
  }

  class SpellPoints__SpellCastNotification {
    spellName = '';
    spellLevel = '';
    spellPoints = '';

    constructor(spellName, spellLevel, spellPoints) {
      this.spellName = spellName;
      this.spellLevel = spellLevel;
      this.spellPoints = spellPoints;
    }

    notifyCastSpell() {
      let notification = this.buildNotification();

    }

    buildNotification() {
      return (
        `<div class="MuiSnackbar-root MuiSnackbar-anchorOriginBottomCenter mui-1ozswge" role="presentation"><div class="MuiPaper-root MuiPaper-elevation MuiPaper-rounded MuiPaper-elevation6 MuiAlert-root MuiAlert-filledSuccess MuiAlert-filled mui-19dc6ow" role="alert" style="opacity: 1; transform: none; transition: opacity 225ms cubic-bezier(0.4, 0, 0.2, 1) 0ms, transform 150ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;" direction="up"><div class="MuiAlert-icon mui-1l54tgj"><svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeInherit mui-1cw4hi4" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="SuccessOutlinedIcon"><path d="M20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4C12.76,4 13.5,4.11 14.2, 4.31L15.77,2.74C14.61,2.26 13.34,2 12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0, 0 22,12M7.91,10.08L6.5,11.5L11,16L21,6L19.59,4.58L11,13.17L7.91,10.08Z"></path></svg></div><div class="MuiAlert-message mui-1xsto0d"><div class="MuiTypography-root MuiTypography-body1 MuiTypography-gutterBottom MuiAlertTitle-root mui-5cgd4k">Spell Cast</div>Cast ${this.spellName} at level ${this.spellLevel} (-${this.spellPoints} spell points)</div><div class="MuiAlert-action mui-1mzcepu"><button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-colorInherit MuiIconButton-sizeSmall mui-a26yix" tabindex="0" type="button" aria-label="Close" title="Close"><svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeSmall mui-1k33q06" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="CloseIcon"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"></path></svg></button></div></div></div>`
      )
    }
  };

  class SpellPoints__Page_Sheet {
    _content = null;
    _sheet = null;
    _player = null;
    platform = "desktop";

    constructor(content, sheet, player, platform = "desktop") {
      console.log('Spell point tracker active');
      this._content = content;
      this._sheet = sheet;
      this._player = player;
      this.platform = platform;

      // Bind functions
      this.actionCastClick = this.actionCastClick.bind(this);
      this.cast = this.cast.bind(this);
      this.castClick = this.castClick.bind(this);
      this.recoverPoints = this.recoverPoints.bind(this);
      this.rest = this.rest.bind(this);
      this.setPoints = this.setPoints.bind(this);
      this.spendPoints = this.spendPoints.bind(this);
      this._renderSpellPointCounter = this._renderSpellPointCounter.bind(this);
      this._registerActionTabListeners = this._registerActionTabListeners.bind(this);
      this._registerRestConfirmListeners = this._registerRestConfirmListeners.bind(this);
      this._registerSpellTabListeners = this._registerSpellTabListeners.bind(this);
      this._updateSidePanel = this._updateSidePanel.bind(this);

      // Register listeners
      this._registerListeners();
      this._registerObservers();
      // Set the system status to loaded
      this._player.system().setLoaded();
    }

    _registerListeners() {
      if (this.platform === "desktop") {
        this._content.getElementsByClassName('ct-primary-box__tab--spells')[0].addEventListener('click', () => this._registerSpellTabListeners());
        this._content.getElementsByClassName('ct-primary-box__tab--actions')[0].addEventListener('click', () => this._registerActionTabListeners());
        this._registerActionTabListeners();
      } else if (this.platform === "tablet" || this.platform === "mobile") {
        const activePage = this._content.querySelector('.ct-component-carousel__active');
        const mutationObserver = new MutationObserver(mutations => {
          mutations.forEach((mutation) => {
            const { target } = mutation;
            if (target.querySelector(`.ct-spells-${this.platform}`)) {
              this._renderSpellPointCounter();
            }
          });
        });
        mutationObserver.observe(activePage, {
          childList: true
        });
      } else {
        console.log(`Error: Unkown platform ${this.platform}`);
      }
    }

    _registerObservers() {
      this._sidebarObserver();
    }

    _sidebarObserver() {
      let sidebar = document.querySelector('.ct-sidebar');
      let prevState = sidebar.classList.contains('ct-sidebar--visible');

      // Observe Toggle/Show/Hide.
      const mutationObserver = new MutationObserver(mutations => {
        mutations.forEach((mutation) => {
          const { target } = mutation;
          if (mutation.attributeName === 'class') {
            const currentState = mutation.target.classList.contains('ct-sidebar--visible');
            if (prevState !== currentState) {
                prevState = currentState;
                if (currentState) {
                  this._updateSidePanel();
                  // Create observer for inner panel content.
                  let sidebarPane = document.querySelector('.ct-sidebar .ct-sidebar__pane');
                  if (sidebarPane) {
                    const selectedSpellObserver = new MutationObserver(mutations => {
                      mutations.forEach((mutation) => {
                        const { target } = mutation;
                        const spellDetail = target.querySelector('.ct-spell-detail');
                        if (spellDetail) {
                          this._updateSidePanel();
                        }
                        const resetPane = target.querySelector('.ct-reset-pane');
                        if (resetPane) {
                          this._registerRestConfirmListeners();
                        }
                      });
                    });
                    selectedSpellObserver.observe(sidebarPane, {
                      childList: true,
                      subtree: true
                    });
                  }
                }
            }
          }
        });
      });
      mutationObserver.observe(sidebar, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    actionCastClick(evt) {
      setTimeout(() => {
        [...this._content.getElementsByClassName('ddbc-combat-attack--spell')].filter(ele => !ele.evtFlag).forEach(ele => {
          ele.evtFlag = true;
        });
      }, 10);
    }

    cast(level) {
      const cost = SPELL_COST_TABLE[level - 1][1];
      return evt => {
        if (this.spendPoints(cost)){
          console.log('cast level', level, 'spell with', cost, 'points');
        }
        if (!SPELL_COST_TABLE[level - 1][2]) {evt.stopPropagation();}
      };
    }

    castClick() {
      setTimeout(() => {
        [...this._content.getElementsByClassName('ct-content-group')].forEach(el => {
          if (!/^CANTRIP/.test(el.innerText)) {
            const level = +el.innerText[0];
            const lvl = el.querySelector('.ct-content-group__header-content');
            if (!lvl.spFlag){
              lvl.spFlag = true;
              lvl.innerText += ' (Cost ' + SPELL_COST_TABLE[level - 1][1] + ')';
            }
            [...el.getElementsByClassName('ddbc-button')].filter(ele => /CAST$/.test(ele.innerText) && !ele.evtFlag).forEach(ele => {
              ele.evtFlag = true;
              ele.addEventListener('click', this.cast(level));
            });
            [...el.getElementsByClassName('ct-spells-spell')].filter(ele => !ele.evtFlag).forEach(ele => {
              ele.evtFlag = true;
            });
          }
        });
      }, 10);
    }

    _updateSidePanel() {
      const spDetail = document.getElementsByClassName('ct-spell-detail')[0];
      if (spDetail != null) {
        const spCast = spDetail.querySelector('.ct-spell-caster__casting-action > button');
        if (spCast == null) return;
        spCast.innerHTML = spCast.innerHTML.replace('Spell Slot', 'Spell Points');
        const spLvl = spDetail.getElementsByClassName('ct-spell-caster__casting-level-current')[0];
        const spCost = spDetail.getElementsByClassName('ct-spell-caster__casting-action-count--spellcasting')[0];
        spCast.spLvl = spLvl.innerText[0];
        spCost.innerText = SPELL_COST_TABLE[+spCast.spLvl - 1][1];
        spCast.addEventListener('click', evt => this.cast(+spCast.spLvl)(evt));
        [...spDetail.getElementsByClassName('ct-spell-caster__casting-level-action')].forEach(ele => {
          ele.addEventListener('click', evt => {
            setTimeout(() => {
              spCast.spLvl = spLvl.innerText[0];
              spCost.innerText = SPELL_COST_TABLE[+spCast.spLvl - 1][1];
            }, 10);
          });
        });
      }
    }

    recoverPoints(val) {
      if (this._player.recoverPoints(val)) {
        this._renderPointsDisplay();
        return true;
      }
    }

    rest(evt) {
      this.setPoints(player.maxPoints);
    };

    spendPoints(val) {
      if (this._player.spendPoints(val)) {
        this._renderPointsDisplay();
        return true;
      } else {
        alert('Insufficient spell points');
        return false;
      }
    }

    setPoints(val) {
      if (this._player.setPoints(val)) {
        this._renderPointsDisplay();
        return true;
      } else {
        alert(`Invalid spell points: ${val}`);
        return false;
      }
    }

    _registerActionTabListeners(evt) {
      setTimeout(() => {
        [...this._content.querySelectorAll('.ct-actions__content .ddbc-tab-options__header')].forEach(ele => ele.addEventListener('click', this.actionCastClick));
        this.actionCastClick(evt);
      }, 50);
    }

    _registerRestConfirmListeners(evt) {
      setTimeout(() => {
        const longRestButton = document.querySelector('.ct-reset-pane__action .ct-button--confirm');
        longRestButton.addEventListener('click', () => {
          if (longRestButton.classList.contains('ct-button--is-confirming')) {
            this.rest();
          }
        });
      }, 50);
    };

    _registerSpellTabListeners() {
      setTimeout(() => {
        this._renderSpellPointCounter();
      }, 50);
    };

    _renderSpellPointCounter() {
      if (this._content.querySelector('.spell-point-counter') != null) return;
      let tmp = this._content.getElementsByClassName('ct-spells-level-casting__info-group')[2];
      let pdc = tmp.cloneNode(true);
      pdc.childNodes[1].classList.add('spell-point-counter');
      pdc.childNodes[1].innerText = 'Spell Points';
      pdc.childNodes[0].childNodes[0].innerText = '';
      let pdSub = document.createElement('span');
      pdSub.innerText = '–';
      pdSub.style.color = '#BB0000';
      pdSub.style.userSelect = 'none';
      pdSub.style.cursor = 'pointer';
      pdSub.addEventListener('click', evt => {
        this.spendPoints(1);
      });
      pdc.childNodes[0].childNodes[0].appendChild(pdSub);
      let pd = document.createElement('span');
      pd.innerText = this._player.points + ' / ' + this._player.maxPoints;
      pd.id = 'pointsDisplay';
      pd.style.margin = '0 4px';
      pd.style.cursor = 'pointer';
      pd.addEventListener('click', evt => {
        let val = prompt('Override Spell Points', this._player.points);
        if (val == null) return;
        this.setPoints(+val);
      });
      pdc.childNodes[0].childNodes[0].appendChild(pd);
      let pdAdd = document.createElement('span');
      pdAdd.innerText = '+';
      pdAdd.style.color = '#00BB00';
      pdAdd.style.userSelect = 'none';
      pdAdd.style.cursor = 'pointer';
      pdAdd.addEventListener('click', evt => {
        this.recoverPoints(1);
      });
      pdc.childNodes[0].childNodes[0].appendChild(pdAdd);
      tmp.parentNode.appendChild(pdc);
      [...this._content.querySelectorAll('.ct-spells__content .ddbc-tab-options__header')].forEach(ele => ele.addEventListener('click', () => this.castClick()));
      this._content.getElementsByClassName('ct-spells-filter__input')[0].addEventListener('input', () => this.castClick());
      this.castClick();
    }

    _renderPointsDisplay() {
      (document.getElementById('pointsDisplay') || {}).innerText = this._player.points + ' / ' + this._player.maxPoints;
    }
  }

  class SpellPoints__Page_Editor {
    _player = null;
    _content = null;

    constructor(content, player) {
      this._content = content;
      this._player = player;

      this._renderHomeControls = this._renderHomeControls.bind(this);
      if (/\/home\/basic/.test(window.location.pathname)) {
        this._renderHomeControls();
      }

      // Set the system to be loaded
      this._player.system().setLoaded();
    }

    _renderHomeControls() {
      setTimeout(() => {
        const system = this._player.system();
        system.useSpellPoints = system.spSystem?.isProficient === true;
        system.mergeSorcPoints = system.spSystem?.isMartialArts === true;
        const opt = [...this._content.getElementsByClassName('builder-field builder-field-toggles')].find(ele => /Optional Features/.test(ele.innerText));
        if (!opt) {
          setTimeout(() => {this._renderHomeControls()}, 100);
          return;
        }
        const tmp = opt.getElementsByClassName('builder-field-toggles-field')[0];
        const useSp = tmp.cloneNode(true);
        useSp.childNodes[1].innerText = 'Use Spell Points (Variant Rule)';
        useSp.childNodes[0].childNodes[0].classList.remove('ddbc-toggle-field--is-enabled', 'ddbc-toggle-field--is-disabled');
        useSp.childNodes[0].childNodes[0].classList.add(system.useSpellPoints ? 'ddbc-toggle-field--is-enabled' : 'ddbc-toggle-field--is-disabled');
        useSp.childNodes[0].addEventListener('click', evt => {
          if (system.spSystem != null) {
            const tmp = Object.assign(system.spSystem, {characterId: +this._player.id, isProficient: !system.spSystem.isProficient});
            system.getData('custom/action', {method: 'PUT', body: tmp}).then((data) => {
              console.log('updated spell point action');
              system.spSystem.isProficient = tmp.isProficient;
            });
          } else {
            system.getData('custom/action', {method: 'POST', body: {'characterId': +this._player.id, 'name': 'Spell Points', 'actionType': '3'}}).then((data) => {
              console.log('created spell point action');
              (this._player.data?.customActions || []).push(data);
              system.spSystem = (this._player.data?.customActions || []).find(act => act?.name === 'Spell Points');
              const tmp = Object.assign(system.spSystem, {characterId: +this._player.id, isProficient: !system.spSystem.isProficient});
              system.getData('custom/action', {method: 'PUT', body: tmp}).then((data) => {
                console.log('updated spell point action');
                system.spSystem.isProficient = tmp.isProficient;
              });
            });
          }
          system.useSpellPoints = !system.useSpellPoints;
          useSp.childNodes[0].childNodes[0].classList.remove('ddbc-toggle-field--is-enabled', 'ddbc-toggle-field--is-disabled');
          useSp.childNodes[0].childNodes[0].classList.add(system.useSpellPoints ? 'ddbc-toggle-field--is-enabled' : 'ddbc-toggle-field--is-disabled');
        });
        tmp.parentNode.appendChild(useSp);
        const mergeSp = tmp.cloneNode(true);
        mergeSp.childNodes[1].innerText = 'Combine Spell Points with Sorcery Points';
        mergeSp.childNodes[0].childNodes[0].classList.remove('ddbc-toggle-field--is-enabled', 'ddbc-toggle-field--is-disabled');
        mergeSp.childNodes[0].childNodes[0].classList.add(system.mergeSorcPoints ? 'ddbc-toggle-field--is-enabled' : 'ddbc-toggle-field--is-disabled');
        mergeSp.childNodes[0].addEventListener('click', evt => {
          if (system.spSystem != null) {
            const tmp = Object.assign(system.spSystem, {characterId: +this._player.id, isMartialArts: !system.spSystem.isMartialArts});
            system.getData('custom/action', {method: 'PUT', body: tmp}).then((data) => {
              console.log('updated spell point action');
              system.spSystem.isMartialArts = tmp.isMartialArts;
            });
          } else {
            system.getData('custom/action', {method: 'POST', body: {'characterId': +this._player.id, 'name': 'Spell Points', 'actionType': '3'}}).then((data) => {
              console.log('created spell point action');
              (this._player.data?.customActions || []).push(data);
              system.spSystem = (this._player.data?.customActions || []).find(act => act?.name === 'Spell Points');
              const tmp = Object.assign(system.spSystem, {characterId: +this._player.id, isMartialArts: !system.spSystem.isMartialArts});
              system.getData('custom/action', {method: 'PUT', body: tmp}).then((data) => {
                console.log('updated spell point action');
                system.spSystem.isMartialArts = tmp.isMartialArts;
              });
            });
          }
          system.mergeSorcPoints = !system.mergeSorcPoints;
          mergeSp.childNodes[0].childNodes[0].classList.remove('ddbc-toggle-field--is-enabled', 'ddbc-toggle-field--is-disabled');
          mergeSp.childNodes[0].childNodes[0].classList.add(system.mergeSorcPoints ? 'ddbc-toggle-field--is-enabled' : 'ddbc-toggle-field--is-disabled');
        });
        tmp.parentNode.appendChild(mergeSp);
      }, 50);
    }
  }

  class SpellPoints__PageReader {
    _player = null;

    constructor(player) {
      this._player = player;
      this.read = this.read.bind(this);
    }

    read() {
      const content = document.getElementById('character-tools-target');
      if (!content) {return null;}
      const sheet = [...content.getElementsByClassName('ct-character-header-desktop')].length;
      if (sheet) {
        if (!this._player.system().useSpellPoints) {return;}
        return new SpellPoints__Page_Sheet(content, sheet, this._player);
      } else if (/\/builder/.test(window.location.pathname)) {
        return new SpellPoints__Page_Editor(content, this._player);
      } else if ([...content.getElementsByClassName('ct-character-header-tablet')].length) {
        if (!this._player.system().useSpellPoints) {return;}
        return new SpellPoints__Page_Sheet(content, sheet, this._player, "tablet");
      } else if ([...content.getElementsByClassName('ct-character-header-mobile')].length) {
        if (!this._player.system().useSpellPoints) {return;}
        return new SpellPoints__Page_Sheet(content, sheet, this._player, "mobile");
      } else {
        if (this._player.system().loaded-- > 0) {
          console.log('attempting to load point tracker...');
          setTimeout(() => {
            this.read();
          }, 1000);
        } else {
          console.log('point tracker failed to load');
        }
        return;
      }
    }
  }

  const player = new SpellPoints__Player();
  const reader = new SpellPoints__PageReader(player);

  const init = () => {
    player.loadCharacter().then(() => reader.read());
  };

  let initializer = null;
  let prevUrl = '';
  const obs = new MutationObserver(mut => {
    if (location.href !== prevUrl) {
      prevUrl = location.href;
      let delay = 1000;
      if (/\/builder/.test(window.location.pathname) && player.system().loaded === 0) {
        delay = 0;
      }
      clearTimeout(initializer);
      initializer = setTimeout(init, delay);
    }
  });
  obs.observe(document, {subtree: true, childList: true});
})();
