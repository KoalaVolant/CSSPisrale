;( function(){

    $(document).ready( function(){
      
    // par défaut
    $('.titrepis .titr0').addClass('dpb-bloc');
    $('.contpis .qtitr0').addClass('actif');
      
         $('body')
           .on('click', '.titrepis [class^="titr"]', function(){
                var $this = $(this),
                // on récupére le nom du groupe
                idGroupe = $this.attr('class');

                // On désactive tous les groupes
                $('.titrepis [class^="titr"]').removeClass('dpb-bloc');
                $('.contpis [class^="qtitr"]').removeClass('actif');

                // On active le bon groupe
                $('.titrepis .'+ idGroupe +'').addClass('dpb-bloc');
                $('.contpis .q'+ idGroupe +'').addClass('actif');
            });
  
    });
  
  })($);