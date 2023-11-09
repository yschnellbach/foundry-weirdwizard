/**
 * @typedef {Object} CombatHistoryData
 * @property {number|null} round
 * @property {number|null} turn
 * @property {string|null} tokenId
 * @property {string|null} combatantId
 */

/**
 * The client-side Combat document which extends the common BaseCombat model.
 *
 * @extends documents.BaseCombat
 * @mixes ClientDocumentMixin
 *
 * @see {@link documents.Combats}             The world-level collection of Combat documents
 * @see {@link Combatant}                     The Combatant embedded document which exists within a Combat document
 * @see {@link CombatConfig}                  The Combat configuration application
 */
export default class WWCombat extends Combat {

  /* -------------------------------------------- */
  /*  Properties                                  */
  /* -------------------------------------------- */

  /**
   * Return the object of settings which modify the Combat Tracker behavior
   * @type {object}
   */
  get skipActed() {
    return game.settings.get('weirdwizard', 'skipActed');
  }

  /* -------------------------------------------- */


  /* -------------------------------------------- */
  /*  Methods                                     */
  /* -------------------------------------------- */

  /** @override */
  prepareDerivedData() {
    if ( this.combatants.size && !this.turns?.length ) this.setupTurns();
  }

  /* -------------------------------------------- */
  /* -------------------------------------------- */

  /**
   * Begin the combat encounter, advancing to round 1 and turn 1
   * @override
   * @returns {Promise<Combat>}
   */
  async startCombat() {
    await this.setAll();
    this._playCombatSound("startEncounter");
    const updateData = {round: 1, turn: 0};
    Hooks.callAll("combatStart", this, updateData);
    return this.update(updateData);
  }

  /* -------------------------------------------- */

  /**
   * Advance the combat to the next round
   * @override
   * @returns {Promise<Combat>}
   */
  async nextRound() {
    let turn = this.turn === null ? null : 0; // Preserve the fact that it's no-one's turn currently.
    if ( this.settings.skipDefeated && (turn !== null) ) {
      turn = this.turns.findIndex(t => !t.isDefeated);
      if (turn === -1) {
        ui.notifications.warn("COMBAT.NoneRemaining", {localize: true});
        turn = 0;
      }
    }
    let advanceTime = Math.max(this.turns.length - this.turn, 0) * CONFIG.time.turnTime;
    advanceTime += CONFIG.time.roundTime;
    let nextRound = this.round + 1;
    
    // Update the document, passing data through a hook first
    const updateData = {round: nextRound, turn};
    const updateOptions = {advanceTime, direction: 1};
    
    // Reset acted flags
    this.turns.forEach((e) => {
      e.setFlag('weirdwizard', 'acted', false);
    });

    Hooks.callAll("combatRound", this, updateData, updateOptions);
    return this.update(updateData, updateOptions);
  }

  /* -------------------------------------------- */

  /**
   * Advance the combat to the next turn
   * @override
   * @returns {Promise<Combat>}
   */
  async nextTurn() {
    //let turn = this.turn ?? -1;
    let turn = this.turn ?? -1;

    // Determine the next turn number
    let next = null;

    console.log('turn = ' + this.turn +
      '\nskipDefeated = ' + this.settings.skipDefeated + 
      '\nskipActed = ' + this.skipActed)
    
    if (this.settings.skipDefeated) {
      for ( let [i, t] of this.turns.entries() ) {
        if ( i <= turn ) continue;
        if ( t.isDefeated ) continue; // Skip defeated
        console.warn(t.name + ' passou no isDefeated com skipDefeated ligado')
        
        if (this.skipActed) {
          if (t.flags.weirdwizard?.acted) continue; // Skip acted
          next = i;
        } else {
          console.warn(t.name + ' passou no isDefeated com skipActed desligado');
          next = i;
        }
        
        break;
      }
    } else if (this.skipActed) {
      for ( let [i, t] of this.turns.entries() ) {
        if ( i <= turn ) continue;
        if ( t.flags.weirdwizard?.acted ) continue; // Skip acted
        next = i;
        break;
      }
    } else {
      //next = i;
      console.warn('caiu no último else')
      next = turn + 1;
    }

    // Maybe advance to the next round
    let round = this.round;
    if ( (this.round === 0) || (next === null) || (next >= this.turns.length) ) {
      return this.nextRound();
    }

    // Update the document, passing data through a hook first
    const updateData = {round, turn: next};
    const updateOptions = {advanceTime: CONFIG.time.turnTime, direction: 1};
    Hooks.callAll("combatTurn", this, updateData, updateOptions);
    return this.update(updateData, updateOptions);
  }


  /* -------------------------------------------- */

  /**
   * Display a dialog querying the GM whether they wish to end the combat encounter and empty the tracker
   * @returns {Promise<Combat>}
   * @override
   */
  async endCombat() {
    return Dialog.confirm({
      title: game.i18n.localize("COMBAT.EndTitle"),
      content: `<p>${game.i18n.localize("COMBAT.EndConfirmation")}</p>`,
      yes: () => {
        game.time.advance(60); // Advance 1 minute to end 1 minute durations
        this.delete();
      }
    });
  }

  /* -------------------------------------------- */

  /**
   * Assign initiative for a single Combatant within the Combat encounter.
   * Update the Combat turn order to maintain the same combatant as the current turn.
   * @param {string} id         The combatant ID for which to set initiative
   * @param {number} value      A specific initiative value to set
   */
  async setInitiative(id, value) {
    const combatant = this.combatants.get(id, {strict: true});
    await combatant.update({initiative: value});
  }

  /**
   * Assign initiative for all combatants which have not already been assigned.
   * @param {object} [options={}]   Additional options forwarded to the Combat.rollInitiative method
   */
  async setAll() {
    const ids = this.combatants.reduce((ids, c) => {
      /*if ( c.isOwner && (c.initiative === null) )*/ ids.push(c.id);
      return ids;
    }, []);

    let initiative = 1;
    let enemies = 1;
    let allies = 1;

    ids.forEach(c => {
      const cdata = this.combatants.get(c);
      let v = null;

      if ((cdata.actor.type == 'Character') && cdata.flags.weirdwizard?.takingInit) {
        v = initiative;
        initiative += 1;
      } else if (cdata.actor.type == 'Character') {
        v = 200 + allies;
        allies += 1;
      } else {
        v = 100 + enemies;
        enemies += 1;
      }
      
      return this.setInitiative(c, v);
    })
    
  }

  /* -------------------------------------------- */

  /**
   * Define how the array of Combatants is sorted in the displayed list of the tracker.
   * The default sorting rules sort in ascending order of initiative using combatant IDs for tiebreakers.
   * @param {Combatant} a     Some combatant
   * @param {Combatant} b     Some other combatant
   * @inheritdoc
   */
  _sortCombatants(a, b) {
    /*const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    console.log('ia = ' + ia)
    console.log('ib = ' + ib)
    return (ib - ia) || (a.id > b.id ? 1 : -1);*/
    return -super._sortCombatants(a, b);
  }

  /* -------------------------------------------- */
  /*  Turn Events                                 */
  /* -------------------------------------------- */

  /**
   * Manage the execution of Combat lifecycle events.
   * This method orchestrates the execution of four events in the following order, as applicable:
   * 1. End Turn
   * 2. End Round
   * 3. Begin Round
   * 4. Begin Turn
   * Each lifecycle event is an async method, and each is awaited before proceeding.
   * @param {number} [adjustedTurn]   Optionally, an adjusted turn to commit to the Combat.
   * @returns {Promise<void>}
   * @protected
   * @override
   */
  async _manageTurnEvents(adjustedTurn) {
    if ( !game.users.activeGM?.isSelf ) return;
    const prior = this.combatants.get(this.previous?.combatantId);

    // Adjust the turn order before proceeding. Used for embedded document workflows
    if ( Number.isNumeric(adjustedTurn) ) await this.update({turn: adjustedTurn}, {turnEvents: false});
    if ( !this.started ) return;

    // Identify what progressed
    const advanceRound = this.current.round > (this.previous.round ?? -1);
    const advanceTurn = this.current.turn > (this.previous.turn ?? -1);
    if ( !(advanceTurn || advanceRound) ) return;

    // Conclude prior turn
    if ( prior ) await this._onEndTurn(prior);

    // Conclude prior round
    if ( advanceRound && (this.previous.round !== null) ) await this._onEndRound();

    // Begin new round
    if ( advanceRound ) await this._onStartRound();

    // Begin a new turn
    await this._onStartTurn(this.combatant);
  }

  /* -------------------------------------------- */

  /**
   * A workflow that occurs at the end of each Combat Turn.
   * This workflow occurs after the Combat document update, prior round information exists in this.previous.
   * This can be overridden to implement system-specific combat tracking behaviors.
   * This method only executes for one designated GM user. If no GM users are present this method will not be called.
   * @param {Combatant} combatant     The Combatant whose turn just ended
   * @returns {Promise<void>}
   * @protected
   */
  async _onEndTurn(combatant) {
    if ( CONFIG.debug.combat ) {
      console.debug(`${vtt} | Combat End Turn: ${this.combatants.get(this.previous.combatantId).name}`);
    }
  }

  /* -------------------------------------------- */

  /**
   * A workflow that occurs at the end of each Combat Round.
   * This workflow occurs after the Combat document update, prior round information exists in this.previous.
   * This can be overridden to implement system-specific combat tracking behaviors.
   * This method only executes for one designated GM user. If no GM users are present this method will not be called.
   * @returns {Promise<void>}
   * @protected
   */
  async _onEndRound() {
    if ( CONFIG.debug.combat ) console.debug(`${vtt} | Combat End Round: ${this.previous.round}`);
  }

  /* -------------------------------------------- */

  /**
   * A workflow that occurs at the start of each Combat Round.
   * This workflow occurs after the Combat document update, new round information exists in this.current.
   * This can be overridden to implement system-specific combat tracking behaviors.
   * This method only executes for one designated GM user. If no GM users are present this method will not be called.
   * @returns {Promise<void>}
   * @protected
   */
  async _onStartRound() {
    if ( CONFIG.debug.combat ) console.debug(`${vtt} | Combat Start Round: ${this.round}`);
  }

  /* -------------------------------------------- */

  /**
   * A workflow that occurs at the start of each Combat Turn.
   * This workflow occurs after the Combat document update, new turn information exists in this.current.
   * This can be overridden to implement system-specific combat tracking behaviors.
   * This method only executes for one designated GM user. If no GM users are present this method will not be called.
   * @param {Combatant} combatant     The Combatant whose turn just started
   * @returns {Promise<void>}
   * @protected
   */
  async _onStartTurn(combatant) {
    if ( CONFIG.debug.combat ) console.debug(`${vtt} | Combat Start Turn: ${this.combatant.name}`);
  }

}