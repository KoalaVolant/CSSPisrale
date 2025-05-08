function ouvrirOnglet(evt,nomRubrique) {
    // gestion de l'état des onglets
    const ongletActif = document.querySelector('.onglet.actif');
    ongletActif.classList.remove('actif');
    evt.currentTarget.classList.add('actif');

    // gestion de l'état du container
    const rubrique = document.querySelector(`#${nomRubrique}`);
    const rubriquesContent = document.querySelector('.rubriques-content');
    const rubriqueIndex = Array.from(rubriquesContent.children).findIndex((e) => e.id === rubrique.id);
    rubriquesContent.style.setProperty('--left', (rubriqueIndex * -1).toString());
    rubriquesContent.style.setProperty('--right', (rubriqueIndex - 1).toString());
    // rubriquesContent.setAttribute('--left', (rubriqueIndex * -1).toString())
    // rubriquesContent.setAttribute('--right', (rubriqueIndex - 1).toString())
}