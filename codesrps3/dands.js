$(document).ready(function() {
  // Sélectionnez l'élément avec la classe "scdands-replace" et le texte "PV" ou "Scénario"
  var elements = $(".scdands-replace:contains('PV'), .scdands-replace:contains('Scénario')");

  // Parcourez chaque élément correspondant
  elements.each(function() {
    var $this = $(this);
    var parent = $this.parent();

    // Vérifiez le texte de l'élément et ajoutez la classe appropriée
    if ($this.text() === "PV") {
      parent.addClass("pvdands");
    } else if ($this.text() === "Scénario") {
      parent.addClass("scenariodands");
    }
  });
});
