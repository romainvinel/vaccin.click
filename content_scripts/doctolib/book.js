(async function () {
  if (window.hasRun) return;
  window.hasRun = true;

  const url = document.URL; // Sauvegarde de l'URL originale, avant que l'on change de page

  const { locations, stopped } = await browser.storage.sync.get({
    locations: {},
    stopped: false,
    autoBook: false,
  });

  if (stopped || !locations[url]) return;

  const MONTHS = {
    janvier: 1,
    fevrier: 2,
    mars: 3,
    avril: 4,
    mai: 5,
    juin: 6,
    juillet: 7,
    aout: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    decembre: 12,
  };

  // Pas très élégant (on pourrait utiliser un MutationObserver), mais ça fait le boulot et ça permet de laisser souffler les serveurs de Doctolib
  function wait() {
    return new Promise((r) =>
      setTimeout(r, 1000 + Math.floor(Math.random() * 3000))
    );
  }

  function isARNm(text) {
    return /1.+injection.+(?:Pfizer|Moderna)/.test(text);
  }

  function getAvailableSlot() {
    return document.querySelector(".availabilities-slot");
  }

  let found = false;
  try {
    await wait();

    let slot = null;

    const $bookingMotive = document.getElementById("booking_motive");
    if ($bookingMotive) {
      let optionFound = false;
      for (const $option of $bookingMotive.querySelectorAll("option")) {
        // On ne s'occupe que de Pfizer et Moderna.
        // Pour le reste pas besoin de l'extension, de nombreux RDV sont disponibles.
        if (!isARNm($option.textContent)) continue;

        $bookingMotive.value = $option.value;

        const evt = document.createEvent("HTMLEvents");
        evt.initEvent("change", true, true);
        $bookingMotive.dispatchEvent(evt);

        optionFound = true;

        await wait();

        // Il peut y avoir des places pour Moderna mais pas pour Pfizer, ou inversement. Il faut tester les deux.
        slot = getAvailableSlot();
        if (slot !== null) break;
      }

      if (!optionFound) throw new Error("Injection ARNm non disponible");
    } else {
      // Cas où il n'y a qu'un choix
      if (!isARNm(document.getElementById("booking-content").textContent))
        throw new Error("Injection ARNm non disponible");
      slot = getAvailableSlot();
    }

    if (slot === null) throw new Error("Aucun créneau disponible");

    // format : lun. 17 mai 08:54
    const parts = slot.title.match(/([0-9]+) ([a-z]+) ([0-9]+:[0-9]+)/);
    const date = new Date(
      `${MONTHS[parts[2]]} ${parts[1]} ${new Date().getFullYear()} ${parts[3]}`
    );

    if (date - new Date() > 24 * 3600 * 1000)
      throw new Error("Pas de créneau dispo dans les prochaines 24h");

    if (!autoBook) {
      browser.runtime.sendMessage({
        type: "found",
        url,
      });

      return;
    }
    found = true;

    // Sélection du 1er RDV
    getAvailableSlot().click();
    await wait();

    // Sélection du 2ème RDV
    getAvailableSlot().click();
    await wait();

    // Boutons "J'accepte" dans la popup "À lire avant de prendre un rendez-vous"
    let el;
    while (
      (el = document.querySelector(".dl-button-check-inner:not([disabled])"))
    ) {
      el.click();
      await wait();
    }

    // Bouton de confirmation de la popup
    document
      .querySelector(".dl-modal-footer .dl-button-label")
      .dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, cancelable: true })
      );
    await wait();

    // Pour qui prenez-vous ce rendez-vous ? (moi)
    const masterPatientId = document.querySelector(
      'input[name="masterPatientId"]'
    );
    if (masterPatientId) {
      masterPatientId.click();
      await wait();
    }

    // Avez-vous déjà consulté ce praticien ? (non)
    const no = document.getElementById("late_new_patient_question-1");
    if (no) no.checked = true;

    // Confirmation finale
    document.querySelector('button[type="submit"]').click();

    await wait();

    await browser.runtime.sendMessage({
      type: "booked",
      url,
    });
  } catch (e) {
    console.debug(e);

    if (found) {
      // Réservation non terminée
      await browser.runtime.sendMessage({
        type: "found",
        url,
      });

      return;
    }

    await browser.runtime.sendMessage({
      type: "error",
      url,
      error: {
        // From https://stackoverflow.com/a/53624454/1352334
        ...e,
        name: e.name,
        message: e.message,
        stack: e.stack,
      },
    });
  }
})();
