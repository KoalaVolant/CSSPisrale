$(document).ready(function () {
  $('[class^="bylstaffdes"]').click(function() {
      if ($('[class^="d-bylstaffdes"]').hasClass('woosh')){
          $('[class^="d-bylstaffdes"]').removeClass('woosh');
		  $('.d-' + $(this).attr('class')).addClass('woosh');
      }
        $('[class^="bylstaffdes"]').removeClass('titrewoosh');
    	$(this).addClass('titrewoosh');
	  
  });
  });