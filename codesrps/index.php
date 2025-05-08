<?php
  session_start();
  ?>
  <!doctype html>
  <html>
  <head>
  <meta charset="utf-8">
  <title>Page</title>
  <!-- call bootstrap -->
  <link href="http://maxcdn.bootstrapcdn.com/bootstrap/3.3.1/css/bootstrap.min.css" rel="stylesheet">

<style>.wrappy{

}

.messagesite{
background-color:#EBEBEB;
color:#000;
width:500px;
margin:0 auto;
height:100%;
padding:25px;
font-size:15px;
font-family:Verdana;
}</style>

<head><!-- Global site tag (gtag.js) - Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-NTRMXMFJSJ"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-NTRMXMFJSJ');
</script></head>
<div class="wrappy">
<div class="messagesite"><center><img src="http://img15.hostingpics.net/pics/986834tumblrmhnsmsH71c1s55i91o1400.gif" width="300px"></center><br><br>
BONJOUR (ou bonsoir ? :D).<br><br>
Ce site me sert de lien entre mes fichiers CSS et ceux HTML. Merci de ne pas chercher plus loin.
<br><br>Si jamais, visitez Pisrale, vous trouverez pleins pleins de codes et d'autres trucs de graphisme ! : <a href="https://pisrale.forumactif.com">Pisrale</a></div></div>
  
    <?php
unset($_SESSION['inputs']); // on nettoie les données précédentes
  unset($_SESSION['success']);
  unset($_SESSION['errors']);