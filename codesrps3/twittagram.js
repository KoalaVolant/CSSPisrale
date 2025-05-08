$(document).ready(function () {
  $('.postgr1').click(function() {
    $('.postgramimg1').addClass('woosh');
    $('.postgramimg2').removeClass('woosh');
  });
  
    $('.postgr2').click(function() {
    $('.postgramimg2').addClass('woosh');
    $('.postgramimg1').removeClass('woosh');
  });
});