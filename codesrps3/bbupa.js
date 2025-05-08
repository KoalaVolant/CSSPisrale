  document.addEventListener("DOMContentLoaded", function () {
  const elements = document.querySelectorAll('[class^="bylstaffdes"]');
  
  elements.forEach(function (element) {
    element.addEventListener("click", function () {
      const relatedClass = 'd-' + this.classList[0].substring(10); // Obtenez la classe liée
      const relatedElement = document.querySelector('.' + relatedClass);

      if (relatedElement.classList.contains('woosh')) {
        relatedElement.classList.remove('woosh');
      }

      elements.forEach(function (el) {
        el.classList.remove('titrewoosh');
      });

      this.classList.add('titrewoosh');
      relatedElement.classList.add('woosh');
    });
  });
});
