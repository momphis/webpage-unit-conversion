// A unit converter for cycling trip reports.
// This adds converted units next to unit descriptions, so if the page text
// contains
//    I walked 100 km ...
// calling convertUnits() will change that to
//    I walked 100 km (62.6 miles)
// and by loading units.css and adding CSS classes to the body,
// you can hide/show only metric, only imperial, both, or only the original.
// See units.html for a demo.

// It converts distances, weights, temperatures, and speeds found in English
// language text between metric and imperial units.

// CAVEAT:
// This script does not attempt to
// - infer the difference between delta temperatures and absolute temperatures,
//   e.g. "The temperature dropped 5 celsius" should be
//        "The temperature dropped 9 fahrenheit" not
//        "The temperature dropped 41 fahrenheit"
//   though the web page author may give hints:
//   <span class="unit-delta">5 celsius</span>.
// - convert other unit types or handle arbitrary unit expressions N/m2.
// - handle non-English text.
// - handle numbers written in non-US non-British style with a comma as the
//   decimal point: "1.000,5 kg".
// - distinguish between pounds-mass and pounds-force.
// - deal with extremely precise measurements.
//   Results are formatted to 3 decimal places.
// - convert precisions : 5 m +/- 2 cm.
// - normalize units : .1 lbs -> 45.4 g instead of 0.0454 kg.
// - distinguish between different Imperial and US measures with the same
//   name.  Most of these are volumetric (oz, quart, gallon) or obscure.
// - convert between inches and cm because those are often used in
//   cycling as speced numbers.
//   Per http://sheldonbrown.com/tire-sizing.html
//     Bicycle tires come in a bewildering variety of sizes.
//     To make matters worse, in the early days of cycling,
//     every country that manufactured bicycles developed
//     its own system of marking the sizes. These different
//     national sizing schemes created a situation in which
//     the same size tire would be known by different numbers
//     in different countries. Even worse, different-sized
//     tires that were not interchangeable with one another
//     were often marked with the same numbers!

(function (global) {

// maps unit name to [is_metric, offset, factor, unit_name, plural_unit_name].
// Unit names used as keys should be all lower-case, but the display versions
// may be of any case.
var units = {
  // NAME     METRIC   OFFSET  RATIO  DISPLAY_NAME,PLURAL_DISPLAY_NAME
  // Don't convert mm, cm, or inches since they're used for speced numbers on
  // tools and bike parts more often than not.  See caveat above.
  'ft':      [false,        0, .3048, 'm'],
  'yard':    [false,        0, .9144, 'm'],
  'm':       [true,         0,  3.28, 'ft'],
  'mile':    [false,        0, 1.609, 'km'],
  'km':      [true,         0, 0.626, 'mile', 'miles'],
  'mph':     [false,        0, 1.609, 'kph'],
  'kph':     [true,         0, 0.626, 'mph'],
  'lb':      [false,        0, 0.454, 'kg'],
  'kg':      [true,         0, 2.204, 'lb', 'lbs'],
  'stone':   [false,        0,  6.35, 'kg'],
  // Assume not a delta.  See caveat above.
  '\u00b0c': [true,  32 * 5/9,   9/5, '\u00b0F'],
  '\u00b0f': [false,      -32,   5/9, '\u00b0C']
};

// Aliases.
units['foot'] = units['feet'] = units['ft'];
units['meter'] = units['m'];
units['kilometer'] = units['km'];
units['c'] = units['centigrade'] = units['celsius'] = units['\u00b0c'];
units['f'] = units['fahrenheit'] = units['\u00b0f'];
// More often weight than British currency.
// We ignore pounds-mass / pounds-force distinction since we do not yet deal
// with Newtons.
units['pound'] = units['lb'];
units['kilogram'] = units['kilogramme'] = units['kilo'] = units['kg'];

var unitPattern = [];
for (var k in units) {
  if (units.hasOwnProperty(k)) {
    unitPattern.push(k);
  }
}
// Order longer later so we match the longest possible unit name.
unitPattern.sort(function (a, b) { return b.length - a.length; });
// A non-negative integer numerator and counting-number denominator.
var fractionPattern =
    '(?:\\d+\\s*[/\u2215]\\s*0*[1-9]\\d*' +  // A numerator and denominator
    '|[\u00bc-\u00be\u2153-\u215e])'; // A dedicated fraction code-point
// Recognizes a number parseable by strToNum.
var numberPattern = '[+-]?'  // Sign
    + '(?:'
    +   '(?:'
    +     '\\d+(?:,\\d+)*'  // Integer.  See comma as decimal pt caveat above.
    +     '(?:'
    +       '\\.\\d+'  // Fraction as decimal point and digits: "4.5"
    +       '|\\s+' + fractionPattern  // Or a fraction: "4 1/2"
    +     ')?'  // The fraction is optional.
    +   ')'
    +   '|\\.\\d+'  // Or a value < 1 without an integer portion: ".25"
    +   '|' + fractionPattern  // Or a stand-alone fraction: "7/8"
    + ')';
// A pattern that recognizes a quantity or range thereof.
unitPattern =
    // number in group 1
    '(' + numberPattern + ')' +
    // optional range with end number in group 2
    '(?:\\s*(?:-|\\bto\\b|\\band\\b)\\s*(' + numberPattern + '))?' +
    // stop words
    '(?:\\s+deg(?:ree)?s?\\b)?' +  // deg, degree are often used with temp.
    // unit type in group 3
    '\\s*('+ unitPattern.join('|') + ')s?(?!=\w)';

global.convertUnits = function convertUnits(opt_domNode) {
  var domNode = opt_domNode || document.body;

  // Accumulates the content of text chunks under domNode.  Later the
  // concatenation of such chunks.
  var fullText = [];
  // textNodes[i] is the DOM node containing the portion of the joined fullText:
  // fullText.substring(textOffsets[i], textOffsets[i+1])
  var textNodes = [];
  var textOffsets = [];
  var offset = 0;
  function findTextNodes(node) {
    if (node.nodeType === 1 /* ELEMENT */) {
      // Skip the textual content of script and style elements which are not
      // part of the textual content of the page.
      var name = node.nodeName;
      if (/(?:^|:)(SCRIPT|STYLE|TEXTAREA)$/i.test(name)) { return; }
    }
    if (node.nodeType === 3 /* TEXT_NODE */) {
      var text = node.nodeValue;
      if (text) {  // Dupes in textOffsets might complicate the algo below.
        fullText.push(text);
        textNodes.push(node);
        textOffsets.push(offset);
        offset += text.length;
      }
    } else {
      for (var child = node.firstChild; child; child = child.nextSibling) {
        findTextNodes(child);
      }
    }
  }
  findTextNodes(domNode);
  textOffsets.push(offset);  // Maintain relation above.
  fullText = fullText.join('');

  // Attached to quantities processed by this script to prevent re-processing.
  var PROCESSED_CLASS_NAME = 'unit-processed';
  // Attached to quantities specified in Imperial/English units: lbs., ft.
  var IMPERIAL_CLASS_NAME = 'unit-imp';
  // Attached to quantities specified in SI units: kg, m.
  var SI_CLASS_NAME = 'unit-si';
  // Attached to quantities specified by the page author.
  var PRIMARY_CLASS_NAME = 'unit-primary';
  // Attached to quantities that are added by this script.
  var AUXILIARY_CLASS_NAME = 'unit-auxiliary';
  // Can be attached by the page author to elements that contain delta units.
  var DELTA_CLASS_NAME = 'unit-delta';

  // Create a new regexp instance so we do not inherit any loop state like
  // lastIndex from prior runs.
  var pattern = new RegExp(unitPattern, 'gi');
  var matches = [];
  for (var m; m = pattern.exec(fullText);) {
    m.end = pattern.lastIndex;
    m.start = m.end - m[0].length;
    matches.push(m);
  }

  // Iterate in reverse over matches so mutations to the document don't
  // invalidate assumptions about relationships between the portions of
  // textOffsets and textNodes still in play.

  // Index of chunk in textNodes being processed by this script.  This is used
  // to keep lookups into textOffsets to O(1) amortized.
  var textOffsetIdx = textNodes.length - 1;

  for (var i = matches.length; --i >= 0;) {
    var match = matches[i];
    var start = match.start, end = match.end;

    // Advance cursor past all text nodes between last match and current one.
    while (textOffsetIdx >= 0
           && textOffsets[textOffsetIdx] >= end) {
      --textOffsetIdx;
    }
    var lastTextNode = textNodes[textOffsetIdx];
    if (ancestorHasClass(lastTextNode, PROCESSED_CLASS_NAME)) {
      continue;
    }
    var scalarValueLeft = strToNum(match[1]);
    var scalarValueRight = match[2] ? strToNum(match[2]) : NaN;
    var unit = match[3].toLowerCase();

    var unitDetails = units[unit];
    var isMetric = unitDetails[0];
    var unitOffset = unitDetails[1];  // For non abs-zero based temperatures.
    var ratio = unitDetails[2];
    var singularForm = unitDetails[3];
    var pluralForm = unitDetails[4] || singularForm;

    if (unitOffset && ancestorHasClass(lastTextNode, DELTA_CLASS_NAME)) {
      //  20 deg C = 68 deg F and
      //   5 deg C = 37 deg F and
      //  20 deg C +  5 deg C =  25 deg C and
      //  68 deg F + 37 deg F = 105 deg F but
      // 105 deg F = 40 5/9 F
      // Since zero in Fahrenheit is not zero in Celsius, we cannot
      // treat absolute temperatures the same as an amount of change
      // in temperature.
      // We need to ignore the offset when converting deltas.
      unitOffset = 0;
      // TODO: requiring explicit annotation of deltas is not ideal
      // but the author knows of no simple contextual cues that reliably
      // distinguish the two.
    }

    var auxLeft = (scalarValueLeft + unitOffset) * ratio;
    var auxRight = (scalarValueRight + unitOffset) * ratio;
    var auxUnit = (auxLeft !== 1 || auxRight === auxRight)
        ? pluralForm : singularForm;

    var startTextOffsetIdx = textOffsetIdx;
    while (startTextOffsetIdx >= 0
           && textOffsets[startTextOffsetIdx] > start) {
      --startTextOffsetIdx;
    }

    // Pull the matching text into a SPAN.
    var doc = domNode.ownerDocument;
    var span;
    for (var j = startTextOffsetIdx; j <= textOffsetIdx; ++j) {
      var unitTextNode = splitText(
          textNodes[j],
          Math.max(0, start - textOffsets[j]),
          Math.min(end, textOffsets[j+1]) - textOffsets[j]);
      span = makeSpan(
        doc,
        [PROCESSED_CLASS_NAME, PRIMARY_CLASS_NAME,
         (isMetric ? SI_CLASS_NAME : IMPERIAL_CLASS_NAME)])
        .done();
      unitTextNode.parentNode.replaceChild(span, unitTextNode);
      span.appendChild(unitTextNode);
    }

    // We attempt to construct a measure microformat as documented at
    // http://microformats.org/wiki/measure .
    var altSpan = makeSpan(
      doc,
      [PROCESSED_CLASS_NAME, AUXILIARY_CLASS_NAME,
       (isMetric ? IMPERIAL_CLASS_NAME : SI_CLASS_NAME),
       'hmeasure'])
        .title(match[0])
        .span(['num'])
          .text(significantDigits(auxLeft, 3))
        .done();
    if (auxRight === auxRight) {
      altSpan.text('-')
          .span(['num'])
            .text(significantDigits(auxRight, 3))
          .done();
    }
    altSpan = altSpan.text(' ')
        .span(['unit'])
          .text(auxUnit)
        .done();
    insertAfter(altSpan.done(), span);

    textOffsetIdx = startTextOffsetIdx;
  }
};

// Returns a builder for SPANs.
function makeSpan(doc, classes) {
  var element = doc.createElement('span');
  element.className = classes.join(' ');
  return {
    element: element,
    parent: null,
    text: function (s) {
      this.element.appendChild(doc.createTextNode(s));
      return this;
    },
    title: function (s) {
      this.element.title = s;
      return this;
    },
    span: function (childClasses) {
      var child = makeSpan(doc, childClasses);
      this.element.appendChild(child.element);
      child.parent = this;
      return child;
    },
    done: function () { return this.parent || this.element; }
  };
}

function significantDigits(num, nDigits) {
  var str = '' + num;
  // Remove any scientific notation suffix to avoid confusion.
  var exp = str.match(/[eE][+-]?\d+$/);
  exp = exp ? exp[0] : '';
  // The non-exponent portion.
  var mantissa = str.substring(0, str.length - exp.length);
  // First, replace any insignificant digits with 0.
  return mantissa.replace(
      new RegExp('((?:\\d\\.?){1,' + nDigits + '})((?:\\d\\.?)*)'),
      function (_, sig, insig) {
        return sig + insig.replace(/\d/g, '0');
      })
      // Strip off any zeroes at the end of the fraction.
      .replace(/\.(\d*[1-9])?0+$/, '.$1')
      // Get rid of a terminal decimal point.
      .replace(/\.$/, '')
      + exp;
}

// Splits a text node out of textNode comprising the content between
// character indices start and end, and returns that text node without
// affecting the textual content of the document as a whole.
function splitText(textNode, start, end) {
  var text = textNode.nodeValue;
  if (end != text.length) {
    textNode.splitText(end);
  }
  return start ? textNode.splitText(start) : textNode;
}

// Attaches node to preceder's parent node after preceder.
function insertAfter(node, preceder) {
  preceder.parentNode.insertBefore(node, preceder.nextSibling);
}

// True iff node or an ancestor is an HTML element with the given class. */
function ancestorHasClass(node, className) {
  for (; node; node = node.parentNode) {
    if (node.nodeType === 1 /* ELEMENT */
        && node.className.split(' ').indexOf(className) >= 0) {
      return true;
    }
  }
  return false;
}

var codePointToFraction = {
  '\u00bc': 1/4,
  '\u00bd': 1/2,
  '\u00be': 3/4,
  '\u2153': 1/3,
  '\u2154': 2/3,
  '\u2155': 1/5,
  '\u2156': 2/5,
  '\u2157': 3/5,
  '\u2158': 4/5,
  '\u2159': 1/6,
  '\u215A': 5/6,
  '\u215B': 1/8,
  '\u215C': 3/8,
  '\u215D': 5/8,
  '\u215E': 7/8
};

// The number corresponding to s.
// This code assumes '.' is a decimal point, ',' separates myriads, and
// '/' and U+2215 separate the numerator and denominator in a fraction.
function strToNum(s) {
  var sign = s.charAt(0) === '-' ? -1 : 1;
  // Remove sign and myriad separators: "1,000" -> "1000"
  s = s.replace(/[,+\-]/g, '');
  // Extract any fraction.
  var fraction = s.match(/(?:(\d+)\s*[\/\u2215]\s*(\d+)|([\u00bc-\u00be\u2153-\u215e]))$/);
  // Compute the fraction.
  if (fraction) {
    s = s.substring(0, s.length - fraction[0].length).replace(/\s+/, '');
    fraction = fraction[3]
        ? codePointToFraction[fraction[3]]
        : (+fraction[1]) / (+fraction[2]);
  }
  return sign * ((+s || 0) + (fraction || 0));
}
})(this);
