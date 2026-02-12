<script>
/* =====================================================
   ADDON — INFILTRATION (NON DESTRUCTIF)
===================================================== */

(function(){

  const HOLD_MS = 600;
  let timer = null;

  function getStore(){
    return JSON.parse(localStorage.getItem("infiltrations") || "{}");
  }
  function saveStore(o){
    localStorage.setItem("infiltrations", JSON.stringify(o));
  }
  function key(plan,ch,zone){
    return `${plan}|${ch}|${zone}`;
  }

  function mark(cell){
    const plan = cell.dataset.plan;
    const chambre = cell.dataset.chambre;
    const zone = cell.dataset.zone;
    if (!zone || !zone.startsWith("M")) return;

    const store = getStore();
    const k = key(plan,chambre,zone);

    const choice = prompt(
      "INFILTRATION\n\n" +
      "1 = Marquer infiltré\n" +
      "2 = Terminé\n\n" +
      "Autre = annuler"
    );

    if (choice === "1"){
      store[k] = { plan, chambre, zone, date: Date.now() };
      cell.classList.add("infiltre");
    }
    if (choice === "2"){
      delete store[k];
      cell.classList.remove("infiltre");
    }

    saveStore(store);
  }

  document.addEventListener("dblclick", e=>{
    const cell = e.target.closest(".cell");
    if (cell) mark(cell);
  });

  // mobile long-press
  document.addEventListener("touchstart", e=>{
    const cell = e.target.closest(".cell");
    if (!cell) return;
    timer = setTimeout(()=>mark(cell), HOLD_MS);
  });

  document.addEventListener("touchend", ()=>clearTimeout(timer));

  // synchro visuelle
  window.addEventListener("load", ()=>{
    const store = getStore();
    document.querySelectorAll(".cell").forEach(c=>{
      const k = key(c.dataset.plan, c.dataset.chambre, c.dataset.zone);
      if (store[k]) c.classList.add("infiltre");
    });
  });

})();
</script>
