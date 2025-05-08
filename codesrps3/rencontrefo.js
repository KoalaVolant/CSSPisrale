  $(document).ready(function() {
    $('.meet-hover').hover(
      function() {
        // Au survol, ajoute/retire la classe 'dpblock' à l'élément sibling avec la classe 'image-survol'
        $(this).find('.image-survol').toggleClass('dpblock');
      }
    );
  });