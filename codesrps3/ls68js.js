$(document).ready(function () {
  // Quand on clique sur un onglet
  $(".ls68-ong").on("click", function () {
    var onglet = $(this).data("onglet"); // Récupère l'onglet cliqué

    // Supprime les classes actives des autres onglets et contenus
    $(".ls68-ong").removeClass("ls68mactive");
    $(".ls68-ongcontent > div").removeClass("ls68active");

    // Ajoute les classes actives à l'onglet et au contenu correspondant
    $(this).addClass("ls68mactive");
    $('.ls68-ongcontent > div[data-onglet="' + onglet + '"]').addClass("ls68active");
  });
});